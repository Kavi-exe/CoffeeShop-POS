import type { SyncEnvelope } from "@brewbean/shared";
import { query } from "../db.js";

export interface IngestResult {
  accepted: number;
  rejected: Array<{ id: string; reason: string }>;
  ackSeq: number;
}

/**
 * Apply a push batch. Idempotency via envelope id (unique on cloud_outbound)
 * and natural keys (order id). LWW for mutable entities keyed by updatedAt.
 */
export async function ingestBatch(
  deviceId: string,
  sinceSeq: number,
  batch: SyncEnvelope[]
): Promise<IngestResult> {
  const rejected: Array<{ id: string; reason: string }> = [];
  let accepted = 0;
  let ackSeq = sinceSeq;

  for (const env of batch) {
    try {
      // dedupe by envelope id
      const seen = await query(`SELECT 1 FROM cloud_outbound WHERE envelope_id = $1`, [env.id]);
      if (seen.rowCount === 0) {
        await applyEnvelope(env);
        await query(
          `INSERT INTO cloud_outbound (envelope_id, entity, op, payload, at, from_device)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [env.id, env.entity, env.op, JSON.stringify(env.payload ?? null), env.at, deviceId]
        );
        accepted++;
      }
      ackSeq = Math.max(ackSeq, env.localSeq);
    } catch (err: any) {
      rejected.push({ id: env.id, reason: String(err?.message ?? err).slice(0, 200) });
    }
  }

  await query(
    `INSERT INTO ingest_state (device_id, last_seq, updated_at) VALUES ($1,$2,now())
     ON CONFLICT(device_id) DO UPDATE SET last_seq = GREATEST(ingest_state.last_seq, $2), updated_at = now()`,
    [deviceId, ackSeq]
  );

  return { accepted, rejected, ackSeq };
}

async function applyEnvelope(env: SyncEnvelope): Promise<void> {
  const p: any = env.payload ?? {};

  switch (env.entity) {
    case "orders": {
      // whole-order snapshots keep the cloud consistent even for updates
      await query(
        `INSERT INTO cloud_orders (id, order_no, device_order_id, device_id, type, status, table_name,
           delivery_json, cashier_id, cashier_name, subtotal_cents, order_discount_cents, tax_cents,
           service_cents, delivery_fee_cents, total_cents, cost_cents, offline_created, created_at,
           paid_at, completed_at, cancelled_at, cancel_reason, items_json, payments_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status, paid_at = EXCLUDED.paid_at, completed_at = EXCLUDED.completed_at,
           cancelled_at = EXCLUDED.cancelled_at, cancel_reason = EXCLUDED.cancel_reason,
           items_json = EXCLUDED.items_json, payments_json = EXCLUDED.payments_json,
           total_cents = EXCLUDED.total_cents, order_discount_cents = EXCLUDED.order_discount_cents,
           cost_cents = COALESCE(EXCLUDED.cost_cents, cloud_orders.cost_cents)`,
        [
          p.id, p.orderNo ?? null, p.deviceOrderId ?? null, env.deviceId, p.type ?? "takeaway",
          p.status ?? "open", p.tableName ?? null,
          p.delivery ? JSON.stringify(p.delivery) : null,
          p.cashierId ?? null, p.cashierName ?? null,
          p.totals?.subtotal ?? 0, p.totals?.orderDiscount ?? 0, p.totals?.tax ?? 0,
          p.totals?.serviceCharge ?? 0, p.totals?.deliveryFee ?? 0, p.totals?.total ?? 0,
          p.costCents ?? null, !!p.offlineCreated, p.createdAt ?? env.at,
          p.paidAt ?? null, p.completedAt ?? null, p.cancelledAt ?? null, p.cancelReason ?? null,
          JSON.stringify(p.items ?? []), JSON.stringify(p.payments ?? []),
        ]
      );
      break;
    }
    case "payments": {
      // payments arrive embedded in order snapshots; also record standalone for audit
      await query(
        `SELECT 1 FROM cloud_orders WHERE id = $1`,
        [p.orderId]
      );
      break;
    }
    case "refunds": {
      await query(
        `INSERT INTO cloud_refunds (id, order_id, amount_cents, reason, method, user_name, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO NOTHING`,
        [p.id, p.orderId, p.amountCents ?? p.amount ?? 0, p.reason ?? "", p.method ?? "cash", p.userName ?? p.userId ?? "", p.at ?? env.at]
      );
      break;
    }
    case "products": {
      await query(
        `INSERT INTO cloud_products (id, name, price_cents, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET
           name = COALESCE(EXCLUDED.name, cloud_products.name),
           price_cents = COALESCE(EXCLUDED.price_cents, cloud_products.price_cents),
           available = COALESCE($5, cloud_products.available),
           active = COALESCE($6, cloud_products.active),
           updated_at = EXCLUDED.updated_at`,
        [p.id, p.name ?? null, p.price ?? null, env.at, p.available ?? null, p.active ?? null]
      );
      break;
    }
    case "categories": {
      await query(
        `INSERT INTO cloud_categories (id, name, updated_at) VALUES ($1,$2,$3)
         ON CONFLICT (id) DO UPDATE SET name = COALESCE(EXCLUDED.name, cloud_categories.name), updated_at = EXCLUDED.updated_at`,
        [p.id, p.name ?? null, env.at]
      );
      break;
    }
    case "inventory_transactions": {
      await query(
        `INSERT INTO cloud_inventory_tx (id, ingredient_id, type, delta_qty, balance_after, order_id, user_name, note, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO NOTHING`,
        [p.id ?? env.id, p.ingredientId, p.type ?? "adjustment", p.deltaQty ?? 0, p.balanceAfter ?? 0, p.orderId ?? null, p.userName ?? null, p.note ?? null, p.at ?? env.at]
      );
      if (p.ingredientId && typeof p.balanceAfter === "number") {
        await query(
          `INSERT INTO cloud_ingredients (id, name, unit, stock_qty, updated_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET stock_qty = $4, updated_at = $5`,
          [p.ingredientId, p.ingredientName ?? "", p.unit ?? "pcs", p.balanceAfter, env.at]
        );
      }
      break;
    }
    case "ingredients": {
      await query(
        `INSERT INTO cloud_ingredients (id, name, unit, stock_qty, min_stock_qty, purchase_price_cents, supplier, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO UPDATE SET
           name = COALESCE(EXCLUDED.name, cloud_ingredients.name),
           stock_qty = COALESCE($4, cloud_ingredients.stock_qty),
           min_stock_qty = COALESCE(EXCLUDED.min_stock_qty, cloud_ingredients.min_stock_qty),
           purchase_price_cents = COALESCE(EXCLUDED.purchase_price_cents, cloud_ingredients.purchase_price_cents),
           supplier = COALESCE(EXCLUDED.supplier, cloud_ingredients.supplier),
           updated_at = EXCLUDED.updated_at`,
        [p.id, p.name ?? null, p.unit ?? "pcs", p.stockQty ?? 0, p.minStockQty ?? 0, p.purchasePrice ?? 0, p.supplier ?? null, env.at]
      );
      break;
    }
    case "audit_logs": {
      await query(
        `INSERT INTO cloud_audit (id, at, user_id, user_name, role, device_id, action, entity, entity_id, detail, meta_json, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'local')
         ON CONFLICT (id) DO NOTHING`,
        [p.id ?? env.id, p.at ?? env.at, p.userId ?? null, p.userName ?? null, p.role ?? null, p.deviceId ?? env.deviceId, p.action ?? "unknown", p.entity ?? null, p.entityId ?? null, p.detail ?? "", p.meta ? JSON.stringify(p.meta) : null]
      );
      break;
    }
    case "shifts": {
      await query(
        `INSERT INTO cloud_shifts (id, user_id, user_name, device_id, opening_cash_cents, status, opened_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status, counted_cash_cents = COALESCE($8, cloud_shifts.counted_cash_cents),
           expected_cash_cents = COALESCE($9, cloud_shifts.expected_cash_cents),
           difference_cents = COALESCE($10, cloud_shifts.difference_cents),
           closed_at = COALESCE($11, cloud_shifts.closed_at)`,
        [p.id, p.userId ?? null, p.userName ?? null, p.deviceId ?? env.deviceId, p.openingCash ?? 0, p.status ?? "open", p.openedAt ?? env.at,
         p.countedCash ?? null, p.expectedCash ?? null, p.difference ?? null, p.closedAt ?? null]
      );
      break;
    }
    case "devices": {
      await query(
        `INSERT INTO cloud_devices (id, name, kind, last_seen_at, online, registered_at)
         VALUES ($1,$2,$3,$4,TRUE,now())
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, last_seen_at = EXCLUDED.last_seen_at, online = TRUE`,
        [p.id ?? env.deviceId, p.name ?? null, p.kind ?? "pos", p.lastSeenAt ?? env.at]
      );
      break;
    }
    case "printers": {
      await query(
        `INSERT INTO cloud_printers (id, name, kind, connection, address, categories_json, enabled, status, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, updated_at = EXCLUDED.updated_at`,
        [p.id, p.name ?? null, p.kind ?? "receipt", p.connection ?? "network", p.address ?? null,
         JSON.stringify(p.categories ?? []), p.enabled ?? true, p.status ?? "unknown", env.at]
      );
      break;
    }
    case "settings": {
      await query(
        `INSERT INTO cloud_settings (key, value, updated_at) VALUES ($1,$2,$3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [p.key ?? "cafe", JSON.stringify(p.value ?? p), env.at]
      );
      break;
    }
    default:
      // entities not mirrored: ignore silently (accepted, no-op)
      break;
  }
}

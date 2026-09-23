import { getDb, now } from "../db.js";
import { config } from "../config.js";
import { pendingOutboxCount } from "./outbox.js";
import { broadcast } from "../realtime/hub.js";
import type { SyncEnvelope, SyncPushResponse, SyncPullResponse } from "@brewbean/shared";

let running = false;
let timer: NodeJS.Timeout | null = null;

export function startSyncEngine(): NodeJS.Timeout | null {
  if (!config.cloud.apiUrl) {
    console.log("[sync] CLOUD_API_URL not set — running fully offline");
    return null;
  }
  console.log(`[sync] cloud sync enabled → ${config.cloud.apiUrl}`);
  timer = setInterval(() => void tick(), config.cloud.intervalMs);
  void tick();
  return timer;
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await pushOutbox();
    await pullCloud();
  } catch (err: any) {
    recordSyncError(String(err?.message ?? err));
  } finally {
    running = false;
  }
}

function recordSyncError(error: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO sync_state (device_id, last_error, last_sync_at)
     VALUES (?, ?, ?)
     ON CONFLICT(device_id) DO UPDATE SET last_error = excluded.last_error`
  ).run(config.cloud.deviceId, error.slice(0, 300), now());
  broadcast({ type: "sync.status", pendingCount: pendingOutboxCount(), error });
}

function recordSyncOk(): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO sync_state (device_id, last_error, last_sync_at)
     VALUES (?, NULL, ?)
     ON CONFLICT(device_id) DO UPDATE SET last_error = NULL, last_sync_at = excluded.last_sync_at`
  ).run(config.cloud.deviceId, now());
  broadcast({ type: "sync.status", pendingCount: pendingOutboxCount(), lastSyncAt: now() });
}

async function pushOutbox(): Promise<void> {
  const db = getDb();
  const state = getSyncState();
  const rows = db
    .prepare(
      `SELECT seq, envelope_id, entity, op, payload_json, at FROM sync_outbox
       WHERE pushed_at IS NULL AND seq > ? ORDER BY seq LIMIT ?`
    )
    .all(state.lastPushedSeq, config.cloud.batchSize) as any[];

  if (rows.length === 0) return;

  const batch: SyncEnvelope[] = rows.map((r) => ({
    id: r.envelope_id,
    entity: r.entity,
    op: r.op,
    localSeq: r.seq,
    at: r.at,
    deviceId: config.cloud.deviceId,
    payload: JSON.parse(r.payload_json),
    schemaVersion: 1,
  }));

  const res = await fetch(`${config.cloud.apiUrl}/v1/sync/push`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.cloud.apiToken}`,
    },
    body: JSON.stringify({
      deviceId: config.cloud.deviceId,
      sinceSeq: state.lastPushedSeq,
      batch,
      finalSeq: batch[batch.length - 1]!.localSeq,
    }),
  });
  if (!res.ok) throw new Error(`cloud push ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as SyncPushResponse;

  const markPushed = db.prepare(`UPDATE sync_outbox SET pushed_at = ? WHERE seq = ?`);
  const tx = db.transaction(() => {
    for (const r of rows) {
      if (r.seq <= body.ackSeq) markPushed.run(now(), r.seq);
    }
    db.prepare(
      `INSERT INTO sync_state (device_id, last_pushed_seq) VALUES (?, ?)
       ON CONFLICT(device_id) DO UPDATE SET last_pushed_seq = MAX(last_pushed_seq, excluded.last_pushed_seq)`
    ).run(config.cloud.deviceId, body.ackSeq);
  });
  tx();
  recordSyncOk();
}

async function pullCloud(): Promise<void> {
  const db = getDb();
  const state = getSyncState();

  const res = await fetch(`${config.cloud.apiUrl}/v1/sync/pull?sinceSeq=${state.lastPulledSeq}&limit=${config.cloud.batchSize}`, {
    headers: { authorization: `Bearer ${config.cloud.apiToken}` },
  });
  if (!res.ok) throw new Error(`cloud pull ${res.status}`);
  const body = (await res.json()) as SyncPullResponse;

  if (body.batch.length === 0) return;

  const apply = db.transaction((envelopes: SyncEnvelope[]) => {
    for (const env of envelopes) {
      applyCloudEnvelope(env);
    }
  });
  apply(body.batch);

  db.prepare(
    `INSERT INTO sync_state (device_id, last_pulled_seq) VALUES (?, ?)
     ON CONFLICT(device_id) DO UPDATE SET last_pulled_seq = MAX(last_pulled_seq, excluded.last_pulled_seq)`
  ).run(config.cloud.deviceId, body.nextSeq);
}

/**
 * Apply an inbound cloud envelope (e.g. product edits made in the admin
 * dashboard while the café was offline). Last-writer-wins on updatedAt;
 * financial entities are insert-only and skipped if already present.
 */
function applyCloudEnvelope(env: SyncEnvelope): void {
  const db = getDb();
  const p = env.payload as any;

  switch (env.entity) {
    case "products": {
      db.prepare(
        `UPDATE products SET name=COALESCE(?,name), price_cents=COALESCE(?,price_cents),
           available=COALESCE(?,available), active=COALESCE(?,active), updated_at=?
         WHERE id=?`
      ).run(p.name ?? null, p.price ?? null, p.available ?? null, p.active ?? null, env.at, p.id);
      break;
    }
    case "categories": {
      db.prepare(`UPDATE categories SET name=COALESCE(?,name), printer_id=?, updated_at=? WHERE id=?`)
        .run(p.name ?? null, p.printerId ?? null, env.at, p.id);
      break;
    }
    case "settings": {
      db.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`
      ).run(p.key, p.value, env.at);
      break;
    }
    default:
      // financial entities: insert-only handled at cloud ingest; nothing to pull
      break;
  }
}

function getSyncState(): { lastPushedSeq: number; lastPulledSeq: number } {
  const row = getDb()
    .prepare(`SELECT last_pushed_seq, last_pulled_seq FROM sync_state WHERE device_id = ?`)
    .get(config.cloud.deviceId) as any;
  return {
    lastPushedSeq: row?.last_pushed_seq ?? 0,
    lastPulledSeq: row?.last_pulled_seq ?? 0,
  };
}

export function syncStatus(): { enabled: boolean; pending: number; lastSyncAt?: string; lastError?: string } {
  const row = getDb()
    .prepare(`SELECT last_error, last_sync_at FROM sync_state WHERE device_id = ?`)
    .get(config.cloud.deviceId) as any;
  return {
    enabled: !!config.cloud.apiUrl,
    pending: pendingOutboxCount(),
    lastSyncAt: row?.last_sync_at ?? undefined,
    lastError: row?.last_error ?? undefined,
  };
}

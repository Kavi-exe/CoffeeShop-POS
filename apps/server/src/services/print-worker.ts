import { getDb, newId, now } from "../db.js";
import { config } from "../config.js";
import { broadcast } from "../realtime/hub.js";
import { setPrinterStatus } from "./printer-service.js";
import { sendToPrinter } from "../printing/sink.js";

export interface PrintJobInput {
  printerId: string;
  orderId?: string | null;
  orderNo?: number | null;
  kind: "receipt" | "kitchen";
  text: string; // rendered plain-text ticket (ESC/POS-ready)
}

const MAX_ATTEMPTS = 5;

export function enqueuePrintJob(job: PrintJobInput): string {
  const db = getDb();
  const id = newId();
  db.prepare(
    `INSERT INTO print_jobs (id, printer_id, order_id, order_no, kind, payload, payload_kind, status, created_at)
     VALUES (?,?,?,?,?,?, 'text', 'queued', ?)`
  ).run(id, job.printerId, job.orderId ?? null, job.orderNo ?? null, job.kind, job.text, now());
  broadcast({
    type: "printer.job",
    printerId: job.printerId,
    orderId: job.orderId ?? "",
    orderNo: job.orderNo ?? 0,
    station: job.kind,
    status: "queued",
  });
  // fire-and-forget processing; queue is durable so crashes are safe
  void processQueue();
  return id;
}

let processing = false;

export async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    for (;;) {
      const db = getDb();
      const job = db
        .prepare(
          `SELECT pj.*, p.name printer_name, p.connection, p.address, p.usb_device, p.file_sink_dir,
                  p.width_dots, p.codepage, p.copies, p.enabled
           FROM print_jobs pj JOIN printers p ON p.id = pj.printer_id
           WHERE pj.status IN ('queued','printing')
           ORDER BY pj.created_at LIMIT 1`
        )
        .get() as any;
      if (!job) break;
      if (!job.enabled) {
        db.prepare(`UPDATE print_jobs SET status='failed', last_error='printer disabled' WHERE id=?`).run(job.id);
        continue;
      }

      db.prepare(`UPDATE print_jobs SET status='printing' WHERE id=?`).run(job.id);
      try {
        const copies = Math.max(1, job.copies ?? 1);
        for (let i = 0; i < copies; i++) {
          await sendToPrinter({
            connection: job.connection,
            address: job.address,
            usbDevice: job.usb_device,
            fileSinkDir: job.file_sink_dir ?? config.printDir,
            text: job.payload,
          });
        }
        db.prepare(`UPDATE print_jobs SET status='printed', printed_at=?, attempts=attempts+1 WHERE id=?`).run(now(), job.id);
        setPrinterStatus(job.printer_id, "online");
        broadcast({
          type: "printer.job",
          printerId: job.printer_id,
          orderId: job.order_id ?? "",
          orderNo: job.order_no ?? 0,
          station: job.kind,
          status: "printed",
        });
      } catch (err: any) {
        const attempts = (job.attempts ?? 0) + 1;
        const failed = attempts >= MAX_ATTEMPTS;
        db.prepare(`UPDATE print_jobs SET status=?, attempts=?, last_error=? WHERE id=?`).run(
          failed ? "failed" : "queued",
          attempts,
          String(err?.message ?? err).slice(0, 500),
          job.id
        );
        setPrinterStatus(job.printer_id, failed ? "error" : "offline", String(err?.message ?? err));
        if (failed) {
          broadcast({
            type: "printer.job",
            printerId: job.printer_id,
            orderId: job.order_id ?? "",
            orderNo: job.order_no ?? 0,
            station: job.kind,
            status: "failed",
          });
        } else {
          // exponential backoff: next attempt picked up by timer
          scheduleRetry(attempts);
        }
      }
    }
  } finally {
    processing = false;
  }
}

function scheduleRetry(attempt: number): void {
  const delay = Math.min(30_000, 1000 * 2 ** attempt);
  setTimeout(() => void processQueue(), delay);
}

/** Periodic sweep for jobs that were mid-flight when the server restarted. */
export function startPrintWorker(): NodeJS.Timeout {
  void processQueue();
  return setInterval(() => void processQueue(), 10_000);
}

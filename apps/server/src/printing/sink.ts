import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { escposBytes } from "./escpos.js";

export interface PrinterTarget {
  connection: "network" | "usb" | "bluetooth" | "file";
  address?: string | null;
  usbDevice?: string | null;
  fileSinkDir?: string | null;
  text: string;
}

/**
 * Transport layer. Production printers use raw TCP 9100 (ESC/POS bytes).
 * `file` writes .prn job files — used in development and for spooling to
 * CUPS (`lp -o raw job.prn`) or Windows printers via a watcher service.
 */
export async function sendToPrinter(target: PrinterTarget): Promise<void> {
  const bytes = escposBytes(target.text);

  switch (target.connection) {
    case "network": {
      const [host, portStr] = (target.address ?? "").split(":");
      const port = Number(portStr || 9100);
      if (!host) throw new Error("Printer address missing (host:port)");
      await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection({ host, port }, () => {
          socket.write(bytes, (err) => (err ? reject(err) : socket.end()));
        });
        socket.setTimeout(8000);
        socket.on("data", () => socket.end());
        socket.on("close", () => resolve());
        socket.on("timeout", () => {
          socket.destroy();
          reject(new Error(`Printer ${host}:${port} timed out`));
        });
        socket.on("error", (err) => reject(err));
      });
      return;
    }

    case "file": {
      const dir = target.fileSinkDir ?? config.printDir;
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const name = path.join(dir, `job-${stamp}-${Math.random().toString(36).slice(2, 8)}.prn`);
      fs.writeFileSync(name, bytes);
      return;
    }

    case "usb":
    case "bluetooth": {
      // Node cannot open these device handles portably; spool via file sink.
      // Real deployments: map the device into PRINT_SINK=file watcher or CUPS.
      const dir = target.fileSinkDir ?? config.printDir;
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      fs.writeFileSync(path.join(dir, `job-${stamp}.prn`), bytes);
      return;
    }

    default:
      throw new Error(`Unsupported printer connection: ${target.connection}`);
  }
}

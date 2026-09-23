# Printer Setup

The system supports **two or more printers** with category-based routing.
Default setup: Printer 01 = Kitchen (food/bakery/desserts), Printer 02 = Bar
(coffee/tea/juice/smoothies/soft drinks).

## How printing works

```
Order paid → receipt-service
  ├─ receipt → "receipt" printer        (customer copy)
  └─ kitchen tickets → split by item station:
       bar items     → printer with 'bar' categories
       kitchen items → printer with 'kitchen' categories
```

Every job enters a **durable SQLite queue** (`print_jobs`). A worker sends jobs
with **exponential-backoff retries (5 attempts)** and records status
(queued → printing → printed/failed). If a printer is offline, jobs wait and
print automatically when it returns. POS and dashboards see live status via
WebSocket.

## Connection types

| Type | Config | Notes |
|---|---|---|
| **Network (recommended)** | `connection: network`, `address: 192.168.1.50:9100` | Raw TCP 9100, works with Epson/Xprinter/Rongta/etc. Give the printer a static DHCP lease. |
| **USB** | `connection: usb`, `usbDevice: /dev/usb/lp0` (Linux) | On Linux: `sudo lpadmin -p kitchen -E -v usb://...`; or map via CUPS raw queue. On Windows, share the printer and use a raw spooler. |
| **File sink (dev/no printer)** | `connection: file` | Writes `.prn` files to `data/print-jobs/` — inspect bytes, or point a spooler/`lp -o raw` at the folder. Default in development. |

## Configuration

Admin → Printers (or API):

```http
PUT /v1/printers/printer-01
{
  "name": "Kitchen Printer",
  "kind": "kitchen",
  "connection": "network",
  "address": "192.168.1.50:9100",
  "widthDots": 576,
  "categories": ["desserts", "snacks", "bakery", "specials"],
  "printModifiers": true,
  "copies": 1,
  "enabled": true
}
```

Category ids: `coffee, tea, juice, smoothies, soft-drinks, desserts, snacks,
bakery, specials`.

## Test print

```bash
curl -X POST http://localhost:8080/v1/printers/printer-01/test \
  -H "Authorization: Bearer $TOKEN"
```

or Admin → Printers → Test. A test page confirms cabling, IP and codepage.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Jobs stuck `queued` | Printer offline → check IP/cable; queue auto-retries |
| Garbled text | Wrong codepage — set `codepage` (try `cp437` or `cp850`) |
| Nothing prints, status `error` | Attempts exhausted → check printer, press Test to reset status |
| Receipt fine, kitchen missing | Check category list on the kitchen printer config |

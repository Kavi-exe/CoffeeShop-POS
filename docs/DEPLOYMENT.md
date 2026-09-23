# Production Deployment

## Topology

| Piece | Where | Notes |
|---|---|---|
| Local server | Café mini-PC (Intel NUC / Pi 5 / any x86 box) | Wired LAN preferred; UPS recommended |
| POS tablets | 2× Android/iPad kiosks on café Wi-Fi | Chrome PWA / Add to Home Screen |
| Printers | 2× ESC/POS on LAN | Static DHCP leases |
| Cloud API + Postgres | VPS or managed (Neon/Railway/Fly/EC2) | HTTPS via Caddy/nginx + Let's Encrypt |
| Admin dashboard | Static hosting (Netlify/Vercel/CGP) behind HTTPS | owner's phone |

## Local server (systemd)

```ini
# /etc/systemd/system/brewbean.service
[Unit]
Description=BrewBean Local POS Server
After=network.target

[Service]
Type=simple
User=brewbean
WorkingDirectory=/opt/brewbean/apps/server
EnvironmentFile=/opt/brewbean/apps/server/.env
ExecStart=/usr/bin/node dist/main.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now brewbean
```

Build first: `npm run build` (emits `dist/`).

## Cloud (example: Ubuntu VPS + Caddy)

```bash
# Caddyfile
cloud.yourcafe.com {
  reverse_proxy localhost:8090
}
```

Caddy terminates TLS automatically. The dashboard's static build can be served
from the same host or a CDN.

## Security checklist

- [ ] `JWT_SECRET`, `JWT_REFRESH_SECRET`, `DEVICE_INGEST_TOKEN` are unique 64-hex values
- [ ] Owner password changed from seed; cashier PINs changed
- [ ] Cloud API behind HTTPS only (HSTS)
- [ ] Café LAN: POS/printers/server on a dedicated VLAN; no direct internet exposure of :8080
- [ ] Nightly SQLite backup + offsite copy; nightly `pg_dump`
- [ ] OS auto-updates enabled on café machine
- [ ] Audit log reviewed weekly (Admin → Audit)

## Environment variables

See each app's `.env.example`. Secrets are **only** in `.env` — never committed.

## Operations runbook

| Task | Command |
|---|---|
| Restart local server | `sudo systemctl restart brewbean` |
| Restore DB | see `DATABASE.md` |
| Reprint receipt | POS → Orders → Reprint (or `POST /v1/orders/:id/reprint`) |
| Check print queue | `sqlite3 data/brewbean.db 'SELECT status,COUNT(*) FROM print_jobs GROUP BY 1'` |
| Check sync lag | `GET /v1/sync/status` → `pending` count |
| Rotate JWT secrets | set new env, restart (sessions invalidate) |

## Scaling beyond one café

The cloud mirror is per-device. Multiple cafés push with distinct
`CLOUD_DEVICE_ID`s; dashboards can be filtered by device/branch by extending the
cloud queries with `device_id` — the schema already carries it on every row.

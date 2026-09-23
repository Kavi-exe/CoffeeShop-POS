# Installation Guide

## Requirements

- **Node.js 20+** (LTS) on the local server machine
- **PostgreSQL 14+** (cloud; can run on a $5 VPS or managed provider)
- Modern browser (Chrome/Edge recommended) for POS tablets — Android tablets,
  iPads, or any touch device with a browser
- 2× thermal receipt printers (ESC/POS, 80mm recommended)

## 1. Get the code

```bash
git clone <your-repo-url> brewbean-pos
cd brewbean-pos
```

## 2. Build shared contracts

```bash
cd packages/shared
npm install
npm run build
```

## 3. Local server (the café machine)

```bash
cd apps/server
cp .env.example .env
# edit .env: set JWT_SECRET + JWT_REFRESH_SECRET to `openssl rand -hex 32` values
npm install
npm run dev        # dev mode
# production: npm run build && npm start
```

First boot creates `data/brewbean.db` and seeds demo catalog, users, printers.
The server listens on **http://<cafe-lan-ip>:8080**.

## 4. Cloud API (VPS)

```bash
cd apps/cloud
cp .env.example .env
# edit .env: DATABASE_URL, JWT_SECRET, DEVICE_INGEST_TOKEN (long random),
#            OWNER_EMAIL / OWNER_PASSWORD
npm install
npm run migrate    # creates the cloud schema
npm run dev        # or: npm run build && npm start
```

Set `CLOUD_API_URL` + `CLOUD_API_TOKEN` in the **server** `.env` to point at the
cloud (token must equal the cloud's `DEVICE_INGEST_TOKEN`).

## 5. POS tablets

```bash
cd apps/pos
cp .env.example .env   # set VITE_DEVICE_ID (pos-01 / pos-02) and VITE_API_URL
npm install
npm run build
```

Deploy `dist/` to the local server (it serves `/pos/` automatically if present):

```bash
cp -r apps/pos/dist/* apps/server/public/pos/   # or set POS_DIST_DIR
```

Open `http://<cafe-lan-ip>:8080/pos/` on each tablet. Log in as `cashier1` / `cashier2`.

**Tablet home-screen tip:** use Chrome "Add to Home screen" for kiosk mode.

## 6. Admin dashboard (owner's phone)

Deploy `apps/admin/dist` to any static host (or behind the cloud API):

```bash
cd apps/admin
cp .env.example .env   # VITE_API_URL = https://your-cloud-domain
npm install
npm run build
```

Serve `dist/` with nginx or any static host over **HTTPS**.

## Docker (all-in-one dev)

```bash
docker compose up --build
```

- POS: http://localhost:5173 · Admin: http://localhost:5174
- Local API: http://localhost:8080 · Cloud API: http://localhost:8090

## Default logins

| Role | User | Password |
|---|---|---|
| Owner | `owner` | `owner123` |
| Manager | `manager` | `manager123` |
| Cashier 1 | `cashier1` | `cashier123` |
| Cashier 2 | `cashier2` | `cashier123` |

**Change these immediately** (Admin → Users) before going live.

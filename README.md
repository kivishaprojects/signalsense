# SignalSense AI — Production Platform

AI traffic analytics platform for smart cities. Supports 3 user roles, simulation + real RTSP cameras, PDF/CSV reports, and license key management for on-premise deployments.

## Quick start (local)

```bash
cd backend
npm install
cp .env.example .env
# Edit .env — set PGHOST, PGUSER, PGPASSWORD, PGDATABASE
npm start
```

First run auto-creates the DB schema and a superadmin user:
- URL: **http://localhost:3001**
- Login: `admin@signalsense.ai` / `Admin@1234`

## Project structure

```
signalsense/
├── backend/
│   ├── server.js              Main server (Express + WebSocket)
│   ├── db/
│   │   ├── schema.sql         All Postgres tables
│   │   └── pool.js            DB connection + migration + seeding
│   ├── middleware/
│   │   └── auth.js            JWT auth + role enforcement
│   ├── services/
│   │   ├── trafficEngine.js   Simulation engine (ticks every 2s, persists to DB)
│   │   └── licenseService.js  License key generate/validate/activate
│   ├── routes/
│   │   └── api.js             All REST API routes
│   ├── reports/
│   │   └── generator.js       PDF (PDFKit) + CSV exports
│   └── .env.example
└── frontend/
    ├── index.html             Login page
    ├── app.html               Main application (all views)
    ├── css/app.css            Shared styles
    └── js/
        ├── shared.js          API helper, WebSocket, toast, utils
        └── app.js             All view logic, charts, CRUD
```

## User roles

| Role | Access |
|------|--------|
| `superadmin` | Full access: cities, license keys, all junctions globally |
| `cityadmin` | Own city: junctions, cameras, users, reports, dashboard |
| `operator` | Read-only: live dashboard, violations, analytics |

## Camera modes (per junction)

- **simulation** — traffic engine generates realistic vehicle counts, triggers AI signal decisions, logs to DB. No hardware needed. Production-grade enough for demos and real deployments without cameras.
- **rtsp** — future: live RTSP stream processed by AI model. Set the `rtsp_url` on each camera record. Integration point for a Python CV process (YOLO) to push detections to this Node server.

## API reference

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/login` | Public | Get JWT token |
| GET | `/api/auth/me` | Any | Current user |
| GET | `/api/snapshot` | Operator+ | Live system state |
| GET | `/api/junctions` | Operator+ | List junctions |
| POST | `/api/junctions` | CityAdmin+ | Add junction |
| PUT | `/api/junctions/:id` | CityAdmin+ | Update junction |
| GET | `/api/cameras` | Operator+ | List cameras |
| POST | `/api/cameras` | CityAdmin+ | Add camera |
| PUT | `/api/cameras/:id` | CityAdmin+ | Update camera / RTSP URL |
| GET | `/api/alerts` | Operator+ | Live alerts |
| GET | `/api/alerts/history` | Operator+ | Historical alerts |
| POST | `/api/alerts/:id/acknowledge` | Operator+ | Acknowledge alert |
| GET | `/api/signal-logs` | Operator+ | Signal decision history |
| GET | `/api/analytics/summary` | Operator+ | Violation + signal stats |
| GET | `/api/reports/pdf` | CityAdmin+ | Download PDF report |
| GET | `/api/reports/csv/:type` | CityAdmin+ | Download CSV (violations/signals/stats) |
| GET | `/api/cities` | SuperAdmin | List all cities |
| POST | `/api/cities` | SuperAdmin | Add city |
| PUT | `/api/cities/:id` | SuperAdmin | Update city |
| GET | `/api/users` | CityAdmin+ | List users |
| POST | `/api/users` | CityAdmin+ | Add user |
| GET | `/api/licenses` | SuperAdmin | List license keys |
| POST | `/api/licenses` | SuperAdmin | Generate license key |
| POST | `/api/licenses/validate` | Public | Validate a key |
| POST | `/api/licenses/activate` | Public | Activate a key |
| PUT | `/api/licenses/:id/revoke` | SuperAdmin | Revoke a key |

## WebSocket

Connect to `ws://host/ws?token=<JWT>`

Events sent by server every 2 seconds:
- `snapshot` — full live state of all junctions
- `alert` — new violation/incident (also triggers toast notification)

## Deploy on Railway

1. Create a Postgres database on Railway (+ New → Database → PostgreSQL)
2. Push this repo to GitHub
3. Railway → New Project → Deploy from GitHub → select the repo
4. Set root directory to `backend` in Railway settings
5. Set these environment variables in Railway:
   - `DATABASE_URL` (Railway provides this automatically from the Postgres service)
   - `PGSSL=true`
   - `JWT_SECRET` (any long random string — `openssl rand -hex 32`)
   - `ADMIN_EMAIL` / `ADMIN_PASSWORD` (your superadmin credentials)
6. Done — Railway gives you a public HTTPS URL

## Deploy on VPS (Ubuntu)

```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs postgresql

# Create DB
sudo -u postgres createdb signalsense

# Install dependencies
cd /var/www/signalsense/backend
npm install --production

# Configure
cp .env.example .env
# Edit .env — fill in all values

# Run with PM2
npm install -g pm2
pm2 start server.js --name signalsense
pm2 startup && pm2 save

# Nginx (for HTTPS + custom domain)
# proxy_pass http://localhost:3001
# WebSocket: proxy_http_version 1.1 + Upgrade/Connection headers
```

## Environment variables

See `.env.example` for all required variables. Critical ones:
- `DATABASE_URL` or individual `PG*` vars
- `JWT_SECRET` — must be long, random, secret
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — used only on first startup to seed superadmin

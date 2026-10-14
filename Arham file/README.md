# Arham Trades Dashboard

Finance-oriented demo dashboard (React + Vite) and API (Node + Express) that demonstrates:

- Deterministic mock trade generation (3,000 trades)
- Background pull jobs with immediate 202 response and SSE progress/completion events
- Deduplication-safe ingestion using MongoDB unique constraints and bulk upserts

This README documents how to run, test, and inspect the application locally.

## Features

- Dashboard UI with summary cards, searchable & paginated trades table, SSE connection status, and pull controls
- SSE-driven notifications: `pull-started`, `pull-progress`, `pull-complete`, `pull-failed`
- Background worker (in-process for the assignment) with progress reporting
- Deterministic trade generator for reproducible data
- Automated backend tests (Node's built-in runner + Supertest)

## Prerequisites

- Node.js 18+ (LTS recommended)
- MongoDB locally available (or provide `MONGODB_URI` to a running instance)

## Quick install

From the project root:

```powershell
cd "c:\Users\saksh\OneDrive\Desktop\Arham files\Arham file"
npm run install:all
```

This installs root, frontend, and backend dependencies.

## Environment variables

Create a `.env` in `backend/` or set env vars in your shell. See `backend/.env.example`.

- `PORT` - backend port (default `3001`)
- `MONGODB_URI` - MongoDB connection string (default `mongodb://127.0.0.1:27017/arham_trades`)
- `BSE_URL` - mock BSE base URL (default `http://localhost:4000`)

Never commit real credentials or `.env` files; keep `backend/.env.example` as the example.

## Run locally (development)

Start MongoDB (example):

```powershell
mongod --dbpath "C:\data\db"
```

Start the mock BSE simulator (optional, used by the worker):

```powershell
npm run start:mock
```

Start backend only:

```powershell
npm run start:backend
```

Start frontend only:

```powershell
npm run start:frontend
```

Start all locally (backend + frontend + mock) in parallel:

```powershell
npm run start:all
```

Open the UI at:

```text
http://localhost:5173
```

## API endpoints (examples)

- `GET /api/health` — health + DB status

	Example response:

```json
{
	"status": "ok",
	"timestamp": "2026-10-14T10:00:00.000Z",
	"port": 3001,
	"database": { "connected": true, "state": 1, "name": "arham_trades" }
}
```

- `GET /api/trades?page=1&limit=25&q=` — paginated trades

- `POST /api/pulls` — start a pull

	Request body example:

```json
{ "durationMs": 15000, "idempotencyKey": "pull-demo-1" }
```

	Response: `202 Accepted` with `{ jobId, status, progress, startedAt }`.

- `GET /api/pulls/:jobId` — job status
- `GET /api/events` — SSE endpoint (open with `EventSource`)

## How to test a quick pull (manual)

1. Ensure MongoDB, backend, and mock BSE are running.
2. Open the dashboard in your browser.
3. Click `Start Data Pull` and set a short duration (e.g., 5s).
4. Watch the SSE status badge and the progress card. When `pull-complete` is received, the frontend will fetch the latest trades and update the table.

## How to test a 15-minute simulation (developer)

The `durationMs` parameter supports up to 900000 (15 minutes). For automated tests, use short durations. To run a manual 15-minute simulation set `durationMs` to `900000` when calling `POST /api/pulls`.

## Automated tests

Run backend tests (Node's test runner + Supertest):

```powershell
cd backend
node --test
```

Or from repo root:

```powershell
npm run test
```

Tests cover health, trade seed generation, pagination, job lifecycle, and idempotency behavior.

## Troubleshooting

- If the frontend shows `SSE disconnected`:
	- Ensure backend is running and reachable at `VITE_API_BASE_URL` (frontend reads this env var).
	- Check proxy, firewall, or reverse-proxy buffering settings that may drop long-lived connections.

- If backend fails at startup complaining about MongoDB:
	- Start `mongod` locally or set `MONGODB_URI` to a reachable Mongo instance.
	- The app fails fast to avoid silently using in-memory store in production.

- Port conflicts: ensure ports `5173` (Vite), `3001` (backend), and `4000` (mock) are free or adjust env vars.

## Architecture

See `docs/architecture.md` for the diagram, component responsibilities, API flow, background job lifecycle, SSE flow, persistence strategy, and scaling notes.

## Preparing for Git

- The project is ready for version control; add a `.gitignore` (already present) and do not commit `.env` files.

## License & attribution

This repository is a learning/demo project. No production license is included.


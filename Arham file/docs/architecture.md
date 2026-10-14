# Architecture

This project uses a clean monorepo layout with separate frontend and backend packages.

## Frontend
- Vite + React
- Purpose: dashboard UI and SSE client subscription
- Source: `frontend/src`

## Backend
- Express + Node.js
- Purpose: trade API, pull orchestration, SSE notifications, storage
- Source: `backend/src`

## API contract

### `GET /api/health`
Returns application health and database connection status.

Example response:
```json
{
  "status": "ok",
  "timestamp": "2026-10-14T10:00:00.000Z",
  "port": 3001,
  "database": {
    "connected": false,
    "state": 0,
    "name": "not-connected"
  }
}
```

### `GET /getTrades`
Returns paginated data for trade records.

Query parameters:
- `page` - page number, default 1
- `limit` - page size, default 25, max 100
- `q` - optional text search across tradeId, client, or symbol

Response includes:
- `total`
- `page`
- `limit`
- `totalPages`
- `hasNextPage`
- `hasPreviousPage`
- `trades`

### `POST /api/pulls`
Starts a background pull job.

Request body:
```json
{
  "durationMs": 5000,
  "idempotencyKey": "pull-1"
}
```

Behavior:
- Returns `202 Accepted` immediately
- Creates a unique `jobId`
- Prevents duplicate or conflicting jobs
- Supports controlled development timing via `durationMs`

### `GET /api/pulls/:jobId`
Returns job status, progress, timestamps, and error details when relevant.

### `GET /api/events`
Creates a single SSE stream for real-time updates.

The stream sends:
- initial `connected` event
- `pull-started`
- `pull-progress`
- `pull-complete`
- periodic heartbeat comments every 20 seconds

The frontend must open a single SSE connection and reuse the correct API base URL from an environment variable such as `VITE_API_BASE_URL`.

## Data generation
- Deterministic 3,000-sample trade seed generation is used for reproducible testing and demo data.
- Trade IDs are unique and stable.
- Duplicate trades are prevented during retries or repeated callbacks.

## MongoDB indexes
The schema includes:
- unique index on `tradeId`
- index for `symbol` + timestamp
- index for `client` + timestamp

## Local development
- Run `mongod` locally.
- Start backend: `cd backend && npm install && npm run dev`
- Start frontend: `cd frontend && npm install && npm run dev`
- Open the frontend at `http://localhost:5173`

## Production note
- If MongoDB is unavailable, startup should fail with a clear message instead of silently continuing with in-memory-only storage.

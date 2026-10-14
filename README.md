# TradeFlow Dashboard 📈

A real-time market intelligence dashboard and serverless API built with **React (Vite)** and **Node.js (Express)**, deployed on **Vercel**.

🌐 **Live Application**: [https://tradeflow-dashboard-jet.vercel.app](https://tradeflow-dashboard-jet.vercel.app)

---

## 🚀 Features

- **Real-Time Market Intelligence**: Interactive summary cards showing total trades, turnover / notional volume (₹), and volume breakdown by top symbols (`RELIANCE`, `TCS`, `INFY`, `HDFCBANK`, `SBIN`, etc.).
- **Deterministic Trade Ledger**: Paginated, searchable trade table with custom page sizes (10, 25, 50 rows per page).
- **Asynchronous Data Pulls**: Immediate `202 Accepted` response with real-time SSE progress updates (`pull-started`, `pull-progress`, `pull-complete`).
- **Resilient Fallback Storage**: Operates smoothly with 3,000+ deterministic seed trades and zero downtime; optionally connects to MongoDB when `MONGODB_URI` is provided.
- **Serverless Architecture**: Runs natively on Vercel Edge/Serverless functions (`/api/*`) without requiring separate hosting or manual port configurations.

---

## 📡 API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Health check & database connection status |
| `GET` | `/api/trades?page=1&limit=10&q=` | Paginated and searchable trade ledger |
| `GET` | `/api/summary` | Aggregated turnover and symbol volume stats |
| `GET` | `/api/pulls` | List of background ingestion jobs |
| `GET` | `/api/pulls/:jobId` | Real-time status of a specific pull job |
| `POST` | `/api/pulls` | Trigger an asynchronous trade ingestion simulation |
| `GET` | `/api/events` | Server-Sent Events (SSE) stream for real-time updates |

---

## 🛠️ Local Development

### 1. Prerequisites
- Node.js 18+

### 2. Installation
```bash
npm install
```

### 3. Run Locally
To run both the Vite frontend and the Express backend:
```bash
# Start frontend dev server
npm run dev

# In another terminal, start the API server
npm start
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

### 4. Build for Production
```bash
npm run build
```

---

## ☁️ Deployment

Configured for **Vercel** with single-command deployment:
```bash
vercel --prod
```
Or connect your GitHub repository to Vercel for automatic CI/CD on every push to `main`.

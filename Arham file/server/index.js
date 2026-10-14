const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3001);
const BSE_URL = process.env.BSE_URL || 'http://localhost:4000';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/arham_trades';
const PULL_DELAY_MS = Number(process.env.PULL_DELAY_MS || 15 * 60 * 1000);

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const clients = new Set();
const dataDir = path.join(__dirname, '..', 'data');
const dataFile = path.join(dataDir, 'trades.json');
fs.mkdirSync(dataDir, { recursive: true });

let store = { trades: {}, lastPullAt: null };
let pull = { state: 'idle', jobId: null, startedAt: null, etaMs: null, error: null };

function loadStore() {
  try {
    const raw = fs.readFileSync(dataFile, 'utf8');
    store = raw ? JSON.parse(raw) : { trades: {}, lastPullAt: null };
  } catch (error) {
    store = { trades: {}, lastPullAt: null };
  }
}

function saveStore() {
  fs.writeFileSync(dataFile, JSON.stringify(store, null, 2));
}

function buildStatus() {
  return {
    ...pull,
    total: Object.keys(store.trades).length,
    lastPullAt: store.lastPullAt,
  };
}

function broadcast(eventName, payload) {
  for (const client of clients) {
    client.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
  }
}

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  res.write(`event: status\ndata: ${JSON.stringify(buildStatus())}\n\n`);
  clients.add(res);

  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
});

app.get('/api/trades', (req, res) => {
  const { q = '', limit = 200, offset = 0 } = req.query;
  let rows = Object.values(store.trades).sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  if (q) {
    const search = String(q).toLowerCase();
    rows = rows.filter((trade) =>
      [trade.tradeId, trade.client, trade.symbol].some((value) => String(value).toLowerCase().includes(search))
    );
  }

  const start = Number(offset) || 0;
  const pageSize = Number(limit) || 200;

  res.json({ total: rows.length, trades: rows.slice(start, start + pageSize) });
});

app.get('/api/summary', (_, res) => {
  const trades = Object.values(store.trades);
  const bySymbol = {};
  let notional = 0;

  for (const trade of trades) {
    const value = Number(trade.quantity) * Number(trade.price);
    notional += value;
    bySymbol[trade.symbol] = (bySymbol[trade.symbol] || 0) + value;
  }

  res.json({ count: trades.length, notional, bySymbol });
});

async function startPull() {
  if (pull.state === 'pulling') return false;

  try {
    const response = await fetch(`${BSE_URL}/getTrades?callbackUrl=${encodeURIComponent(`http://localhost:${PORT}/api/bse-callback`)}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (response.status !== 202) {
      throw new Error(`BSE returned ${response.status}`);
    }

    const payload = await response.json();
    pull = {
      state: 'pulling',
      jobId: payload.jobId,
      startedAt: new Date().toISOString(),
      etaMs: payload.etaMs || PULL_DELAY_MS,
      error: null,
    };
  } catch (error) {
    pull = {
      state: 'error',
      jobId: null,
      startedAt: null,
      etaMs: null,
      error: error.message,
    };
  }

  broadcast('status', buildStatus());
  return pull.state === 'pulling';
}

app.post('/api/pull', async (_, res) => {
  const started = await startPull();
  res.status(202).json({ started });
});

app.post('/api/bse-callback', (req, res) => {
  const { jobId, trades = [] } = req.body || {};
  let added = 0;

  for (const trade of trades) {
    if (!store.trades[trade.tradeId]) {
      store.trades[trade.tradeId] = trade;
      added += 1;
    }
  }

  store.lastPullAt = new Date().toISOString();
  saveStore();

  pull = { state: 'idle', jobId: null, startedAt: null, etaMs: null, error: null };
  console.log(`[ingest] ${jobId}: +${added} trades (total ${Object.keys(store.trades).length})`);

  broadcast('pull-complete', { added, ...buildStatus() });
  res.sendStatus(200);
});

app.get('/api/health', (_, res) => {
  res.json({ status: 'ok', port: PORT, mongodb: 'not connected' });
});

async function connectMongo() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log(`Connected to MongoDB: ${MONGODB_URI}`);
    return true;
  } catch (error) {
    console.error('MongoDB connection failed. Please start MongoDB locally and set MONGODB_URI.');
    console.error('Example: mongodb://127.0.0.1:27017/arham_trades');
    throw error;
  }
}

loadStore();

if (require.main === module) {
  app.listen(PORT, async () => {
    console.log(`Dashboard API on http://localhost:${PORT}`);
    try {
      await connectMongo();
      await startPull();
    } catch (error) {
      console.error('Application startup failed because MongoDB is unavailable.');
      process.exit(1);
    }
  });
}

module.exports = { app, connectMongo, buildStatus, startPull };

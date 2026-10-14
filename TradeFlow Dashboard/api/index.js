const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const { generateDeterministicTrades, buildTrade } = require('./tradeSeed');
const mongoose = require('mongoose');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Attempt non-blocking MongoDB connection if URI provided
const MONGODB_URI = process.env.MONGODB_URI;
if (MONGODB_URI) {
  try {
    mongoose
      .connect(MONGODB_URI, { serverSelectionTimeoutMS: 3000 })
      .then(() => console.log('Connected to MongoDB'))
      .catch((err) => console.warn('MongoDB connection failed, falling back to memory store:', err.message));
  } catch (e) {
    console.warn('MongoDB init warning:', e.message);
  }
}

// In-memory store
let store = {
  trades: {},
  lastPullAt: null,
};

// Populate initial store
function initStore() {
  const possiblePaths = [
    path.join(__dirname, '..', 'data', 'trades.json'),
    path.join(__dirname, 'data', 'trades.json'),
    path.join(process.cwd(), 'data', 'trades.json'),
    path.join(process.cwd(), 'TradeFlow Dashboard', 'data', 'trades.json'),
  ];

  let loaded = false;
  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.trades && Object.keys(parsed.trades).length > 0) {
          store.trades = parsed.trades;
          store.lastPullAt = parsed.lastPullAt || new Date().toISOString();
          loaded = true;
          break;
        }
      }
    } catch (e) {
      // try next path
    }
  }

  if (!loaded || Object.keys(store.trades).length === 0) {
    console.log('Generating 3,000 deterministic seed trades...');
    const seed = generateDeterministicTrades(3000);
    for (const trade of seed) {
      store.trades[trade.tradeId] = trade;
    }
    store.lastPullAt = new Date().toISOString();
  }
}

initStore();

// Job tracking
const jobs = new Map();
const clients = new Set();

function broadcast(eventName, payload) {
  const message = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    try {
      client.write(message);
    } catch (err) {
      clients.delete(client);
    }
  }
}

function getJobWithProgress(job) {
  if (!job) return null;
  if (job.status === 'completed' || job.status === 'failed') return job;

  const elapsed = Date.now() - new Date(job.startedAt).getTime();
  const duration = Math.max(1000, Number(job.durationMs) || 15000);
  const pct = Math.min(100, Math.floor((elapsed / duration) * 100));

  if (pct >= 100) {
    job.status = 'completed';
    job.progress = 100;
    job.completedAt = job.completedAt || new Date().toISOString();
    job.updatedAt = job.completedAt;

    if (!job.tradesAdded) {
      const currentCount = Object.keys(store.trades).length;
      let added = 0;
      for (let i = 0; i < 50; i++) {
        const newTrade = buildTrade(currentCount + i);
        if (!store.trades[newTrade.tradeId]) {
          store.trades[newTrade.tradeId] = newTrade;
          added++;
        }
      }
      store.lastPullAt = new Date().toISOString();
      job.resultCount = added;
      job.totalCount = Object.keys(store.trades).length;
      job.tradesAdded = true;

      broadcast('pull-complete', {
        jobId: job.jobId,
        status: 'completed',
        resultCount: added,
        totalCount: job.totalCount,
        completedAt: job.completedAt,
      });
    }
  } else {
    job.status = 'running';
    job.progress = pct;
    job.updatedAt = new Date().toISOString();
  }

  return job;
}

// Routes

// 1. Health
app.get('/api/health', (_, res) => {
  const mongoState = mongoose.connection.readyState;
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: {
      connected: mongoState === 1,
      state: mongoState,
      name: mongoState === 1 ? mongoose.connection.name : 'in-memory',
    },
    totalTrades: Object.keys(store.trades).length,
  });
});

// 2. SSE Events
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  res.write(`event: connected\ndata: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);
  clients.add(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch (e) {
      clearInterval(heartbeat);
      clients.delete(res);
    }
  }, 10000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
});

// 3. Paginated Trades
app.get('/api/trades', (req, res) => {
  const { q = '', page = 1, limit = 10 } = req.query;

  let rows = Object.values(store.trades).sort((a, b) => {
    const tA = new Date(a.timestamp).getTime() || 0;
    const tB = new Date(b.timestamp).getTime() || 0;
    return tB - tA;
  });

  if (q) {
    const search = String(q).toLowerCase();
    rows = rows.filter((trade) =>
      [trade.tradeId, trade.client, trade.symbol].some((v) =>
        String(v).toLowerCase().includes(search)
      )
    );
  }

  const normalizedPage = Math.max(1, parseInt(page, 10) || 1);
  const normalizedLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / normalizedLimit));
  const start = (normalizedPage - 1) * normalizedLimit;
  const pagedRows = rows.slice(start, start + normalizedLimit);

  res.json({
    total,
    page: normalizedPage,
    limit: normalizedLimit,
    totalPages,
    hasNextPage: normalizedPage < totalPages,
    hasPreviousPage: normalizedPage > 1,
    trades: pagedRows,
  });
});

// 4. Summary Stats
app.get('/api/summary', (_, res) => {
  const trades = Object.values(store.trades);
  const bySymbol = {};
  let notional = 0;

  for (const trade of trades) {
    const value = Number(trade.quantity || 0) * Number(trade.price || 0);
    notional += value;
    bySymbol[trade.symbol] = (bySymbol[trade.symbol] || 0) + value;
  }

  res.json({
    count: trades.length,
    notional: Math.round(notional * 100) / 100,
    bySymbol,
  });
});

// 5. Pulls list
app.get('/api/pulls', (_, res) => {
  const jobsList = Array.from(jobs.values()).map(getJobWithProgress);
  res.json({
    total: jobsList.length,
    jobs: jobsList.reverse(),
  });
});

// 6. Single Pull status
app.get('/api/pulls/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ message: 'Job not found', jobId: req.params.jobId });
  }
  res.json(getJobWithProgress(job));
});

// 7. Start Pull
const handleStartPull = (req, res) => {
  const durationMs = Number(req.body?.durationMs || 15000);
  const safeDuration = Math.max(1000, Math.min(900000, durationMs));

  const jobId = randomUUID();
  const job = {
    jobId,
    status: 'running',
    progress: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    durationMs: safeDuration,
    error: null,
    resultCount: 0,
    totalCount: Object.keys(store.trades).length,
    tradesAdded: false,
  };

  jobs.set(jobId, job);

  broadcast('pull-started', {
    jobId: job.jobId,
    status: 'running',
    progress: 0,
    startedAt: job.startedAt,
    durationMs: job.durationMs,
  });

  // Schedule fast incremental SSE progress events
  const steps = [25, 50, 75, 100];
  const stepInterval = Math.max(200, Math.floor(safeDuration / steps.length));

  steps.forEach((step, idx) => {
    setTimeout(() => {
      const current = jobs.get(jobId);
      if (!current) return;
      if (step === 100) {
        getJobWithProgress(current);
      } else {
        current.progress = step;
        current.updatedAt = new Date().toISOString();
        broadcast('pull-progress', {
          jobId: current.jobId,
          status: 'running',
          progress: step,
          updatedAt: current.updatedAt,
        });
      }
    }, stepInterval * (idx + 1));
  });

  return res.status(202).json({
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    startedAt: job.startedAt,
    durationMs: job.durationMs,
  });
};

app.post('/api/pulls', handleStartPull);
app.post('/api/pull', handleStartPull);

// 8. BSE Callback
app.post('/api/bse-callback', (req, res) => {
  const { trades = [] } = req.body || {};
  let added = 0;
  for (const t of trades) {
    if (t && t.tradeId && !store.trades[t.tradeId]) {
      store.trades[t.tradeId] = t;
      added++;
    }
  }
  if (added > 0) store.lastPullAt = new Date().toISOString();
  res.json({ status: 'ok', added, total: Object.keys(store.trades).length });
});

// Fallback error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`TradeFlow API Server running at http://localhost:${PORT}`);
  });
}

module.exports = app;

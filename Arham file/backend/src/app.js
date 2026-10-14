const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { generateDeterministicTrades } = require('./services/tradeSeed');
const { PullWorker } = require('./workers/pullWorker');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const PORT = Number(process.env.PORT || 3001);
const BSE_URL = process.env.BSE_URL || 'http://localhost:4000';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/arham_trades';
const DEFAULT_PULL_DURATION_MS = Number(process.env.PULL_DELAY_MS || 15 * 60 * 1000);
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 25;
const MAX_PAGE_SIZE = 100;

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Lightweight structured logger (avoid printing sensitive fields)
function logger(level, message, meta = {}) {
  const entry = { ts: new Date().toISOString(), level, message };
  // attach non-sensitive meta
  for (const k of Object.keys(meta)) {
    if (k.toLowerCase().includes('token') || k.toLowerCase().includes('auth') || k.toLowerCase().includes('password')) continue;
    entry[k] = meta[k];
  }
  console.log(JSON.stringify(entry));
}

// Request logging (no bodies)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const elapsed = Date.now() - start;
    logger('info', 'req', {
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      durationMs: elapsed,
      ip: req.ip || req.connection?.remoteAddress,
      query: Object.keys(req.query || {}).length ? req.query : undefined,
    });
  });
  next();
});

// Track Mongo availability
let mongoAvailable = false;
mongoose.connection.on('connected', () => {
  mongoAvailable = true;
  logger('info', 'MongoDB connected', { host: MONGODB_URI });
});
mongoose.connection.on('error', (err) => {
  mongoAvailable = false;
  logger('error', 'MongoDB error', { error: String(err) });
});
mongoose.connection.on('disconnected', () => {
  mongoAvailable = false;
  logger('warn', 'MongoDB disconnected');
});

const clients = new Set();
const jobs = new Map();
const idempotencyKeys = new Map();
const dataDir = path.resolve(__dirname, '../../data');
const dataFile = path.join(dataDir, 'trades.json');
fs.mkdirSync(dataDir, { recursive: true });

let store = { trades: {}, lastPullAt: null };
const pullWorker = new PullWorker({ store, jobs, emitSse: (eventName, payload) => {
  for (const client of clients) {
    try {
      client.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch (e) {
      // individual client may be closed - remove it proactively
      logger('warn', 'Failed to write SSE to client, removing', { error: String(e) });
      try { clients.delete(client); } catch (er) { /* ignore */ }
    }
  }
} });

// Prevent unbounded jobs growth in memory
function pruneJobs(max = 200) {
  if (jobs.size <= max) return;
  logger('info', 'Pruning job map', { before: jobs.size, max });
  const keys = Array.from(jobs.keys());
  for (const key of keys) {
    if (jobs.size <= max) break;
    const j = jobs.get(key);
    if (j && (j.status === 'completed' || j.status === 'failed')) jobs.delete(key);
  }
  // final trim if still too large
  while (jobs.size > max) jobs.delete(Array.from(jobs.keys())[0]);
  logger('info', 'Prune complete', { after: jobs.size });
}

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

function normalizePage(value, fallback = DEFAULT_PAGE) {
  const page = Number(value ?? fallback);
  if (!Number.isFinite(page) || page < 1) return fallback;
  return Math.floor(page);
}

function normalizeLimit(value, fallback = DEFAULT_LIMIT) {
  const limit = Number(value ?? fallback);
  if (!Number.isFinite(limit) || limit < 1) return fallback;
  return Math.min(Math.floor(limit), MAX_PAGE_SIZE);
}

function buildPaginatedTrades({ q = '', page = DEFAULT_PAGE, limit = DEFAULT_LIMIT } = {}) {
  let rows = Object.values(store.trades).sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  if (q) {
    const search = String(q).toLowerCase();
    rows = rows.filter((trade) =>
      [trade.tradeId, trade.client, trade.symbol].some((value) =>
        String(value).toLowerCase().includes(search)
      )
    );
  }

  const normalizedPage = normalizePage(page, DEFAULT_PAGE);
  const normalizedLimit = normalizeLimit(limit, DEFAULT_LIMIT);
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / normalizedLimit));
  const start = (normalizedPage - 1) * normalizedLimit;
  const pagedRows = rows.slice(start, start + normalizedLimit);

  return {
    total,
    page: normalizedPage,
    limit: normalizedLimit,
    totalPages,
    hasNextPage: normalizedPage < totalPages,
    hasPreviousPage: normalizedPage > 1,
    trades: pagedRows,
  };
}

function buildSummary() {
  const trades = Object.values(store.trades);
  const bySymbol = {};
  let notional = 0;

  for (const trade of trades) {
    const value = Number(trade.quantity) * Number(trade.price);
    notional += value;
    bySymbol[trade.symbol] = (bySymbol[trade.symbol] || 0) + value;
  }

  return { count: trades.length, notional, bySymbol };
}

function sanitizeJob(job) {
  return {
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt || null,
    durationMs: job.durationMs,
    error: job.error || null,
    resultCount: job.resultCount || 0,
    totalCount: job.totalCount || 0,
  };
}

function createPullJob({ durationMs, idempotencyKey } = {}) {
  const safeDuration = Number(durationMs || DEFAULT_PULL_DURATION_MS);
  if (!Number.isFinite(safeDuration) || safeDuration < 100 || safeDuration > 900000) {
    const error = new Error('durationMs must be between 100 and 900000 ms');
    error.statusCode = 400;
    throw error;
  }

  if (idempotencyKey && idempotencyKeys.has(idempotencyKey)) {
    const existingJobId = idempotencyKeys.get(idempotencyKey);
    const existingJob = jobs.get(existingJobId);
    if (existingJob) {
      return { duplicate: true, job: existingJob };
    }
  }

  if (Array.from(jobs.values()).some((job) => job.status === 'queued' || job.status === 'running')) {
    const error = new Error('A pull job is already in progress. Please wait for it to finish or retry later.');
    error.statusCode = 409;
    throw error;
  }

  const jobId = randomUUID();
  const job = {
    jobId,
    status: 'queued',
    progress: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    durationMs: safeDuration,
    error: null,
    resultCount: 0,
    totalCount: Object.keys(store.trades).length,
    idempotencyKey: idempotencyKey || null,
  };

  jobs.set(jobId, job);
  if (idempotencyKey) idempotencyKeys.set(idempotencyKey, jobId);

  // prune to avoid unbounded memory growth
  pruneJobs();

  return { duplicate: false, job };
}

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  res.write(`event: connected\ndata: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);
  clients.add(res);

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
});

app.get('/api/health', async (_, res) => {
  const databaseState = mongoose.connection.readyState;
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    port: PORT,
    database: {
      connected: databaseState === 1,
      state: databaseState,
      name: mongoose.connection.name || 'not-connected',
    },
  });
});

app.get('/getTrades', (req, res) => {
  const { page, limit, q } = req.query;
  const payload = buildPaginatedTrades({ page, limit, q });
  res.json({
    ...payload,
    nextPage: payload.hasNextPage ? payload.page + 1 : null,
    previousPage: payload.hasPreviousPage ? payload.page - 1 : null,
  });
});

app.get('/api/trades', (req, res) => {
  const { page, limit, q } = req.query;
  res.json(buildPaginatedTrades({ page, limit, q }));
});

app.get('/api/summary', (_, res) => {
  res.json(buildSummary());
});

app.get('/api/pulls', (_, res) => {
  const jobsList = Array.from(jobs.values()).map(sanitizeJob);
  res.json({ total: jobsList.length, jobs: jobsList });
});

app.get('/api/pulls/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  if (!job) {
    return res.status(404).json({ message: 'Job not found', jobId });
  }

  return res.json(sanitizeJob(job));
});

app.post('/api/pulls', (req, res) => {
  try {
    const durationMs = req.body?.durationMs ?? DEFAULT_PULL_DURATION_MS;
    const idempotencyKey = req.headers['idempotency-key'] || req.body?.idempotencyKey || null;

    // basic validation
    if (idempotencyKey && typeof idempotencyKey !== 'string') {
      return res.status(400).json({ message: 'idempotencyKey must be a string' });
    }
    if (idempotencyKey && idempotencyKey.length > 128) {
      return res.status(400).json({ message: 'idempotencyKey too long' });
    }

    const { duplicate, job } = createPullJob({ durationMs, idempotencyKey });
    if (duplicate) {
      return res.status(200).json({ duplicate: true, job: sanitizeJob(job) });
    }

    setImmediate(() => {
      pullWorker.run(job).catch((error) => {
        const currentJob = jobs.get(job.jobId);
        if (!currentJob) return;
        currentJob.status = 'failed';
        currentJob.error = error.message;
        currentJob.completedAt = new Date().toISOString();
        currentJob.updatedAt = currentJob.completedAt;
        currentJob.progress = 0;
        for (const client of clients) {
          try {
            client.write(`event: pull-failed\ndata: ${JSON.stringify({
              jobId: currentJob.jobId,
              status: 'failed',
              error: currentJob.error,
              completedAt: currentJob.completedAt,
            })}\n\n`);
          } catch (e) {
            logger('warn', 'Failed to write pull-failed SSE to client', { error: String(e) });
            try { clients.delete(client); } catch (er) { }
          }
        }
      });
    });

    return res.status(202).json({
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      startedAt: job.startedAt,
      durationMs: job.durationMs,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      message: error.message || 'Invalid pull request',
      status: 'error',
    });
  }
});

app.post('/api/pull', (req, res) => {
  req.body = req.body || {};
  return app._router.handle(req, res);
});

const Trade = require('./models/Trade');

app.post('/api/bse-callback', async (req, res, next) => {
  try {
    const { jobId, trades = [] } = req.body || {};
    if (!Array.isArray(trades)) return res.status(400).json({ message: 'trades must be an array' });

    // sanitize and validate incoming trades
    const cleanTrades = trades
      .filter((t) => t && t.tradeId && t.client && t.symbol && t.quantity && t.price && t.timestamp)
      .map((t) => ({
        tradeId: String(t.tradeId),
        client: String(t.client),
        symbol: String(t.symbol),
        quantity: Number(t.quantity),
        price: Number(t.price),
        timestamp: new Date(t.timestamp),
      }));

    let added = 0;

    if (mongoose.connection.readyState === 1) {
      // Use bulkWrite with upsert + $setOnInsert to avoid overwriting existing trades and prevent duplicates
      const ops = cleanTrades.map((t) => ({
        updateOne: {
          filter: { tradeId: t.tradeId },
          update: { $setOnInsert: { ...t } },
          upsert: true,
        },
      }));

      if (ops.length > 0) {
        const result = await Trade.bulkWrite(ops, { ordered: false });
        added = result.upsertedCount || 0;
      }
    } else {
      // Fallback to file store if MongoDB unavailable - still dedupe by tradeId
      for (const trade of cleanTrades) {
        if (!store.trades[trade.tradeId]) {
          store.trades[trade.tradeId] = trade;
          added += 1;
        }
      }
      if (added > 0) {
        store.lastPullAt = new Date().toISOString();
        saveStore();
      }
    }

    if (jobId) {
      const job = jobs.get(jobId);
      if (job) {
        job.status = 'completed';
        job.progress = 100;
        job.updatedAt = new Date().toISOString();
        job.completedAt = new Date().toISOString();
        job.resultCount = added;
        job.totalCount = mongoose.connection.readyState === 1 ? await Trade.countDocuments() : Object.keys(store.trades).length;

        // emit completion only after persistence succeeded
        for (const client of clients) {
          try {
            client.write(`event: pull-complete\ndata: ${JSON.stringify({
              jobId,
              status: 'completed',
              resultCount: added,
              totalCount: job.totalCount,
              completedAt: job.completedAt,
            })}\n\n`);
          } catch (e) {
            logger('warn', 'Failed to write pull-complete SSE to client', { error: String(e) });
          }
        }
      }
    }

    // after processing, prune old jobs
    pruneJobs();

    return res.sendStatus(200);
  } catch (err) {
    next(err);
  }
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
      if (Object.keys(store.trades).length === 0) {
        const seedTrades = generateDeterministicTrades(3000);
        for (const trade of seedTrades) {
          if (!store.trades[trade.tradeId]) store.trades[trade.tradeId] = trade;
        }
        store.lastPullAt = new Date().toISOString();
        saveStore();
      }
    } catch (error) {
      console.error('Application startup failed because MongoDB is unavailable.');
      process.exit(1);
    }
  });
}

// Centralized error handler
app.use((err, req, res, next) => {
  try {
    logger('error', err.message || 'Unhandled error', { path: req.path, method: req.method });
  } catch (e) {
    console.error('Logger failed', e);
  }
  const status = err.statusCode || err.status || 500;
  res.status(status).json({ message: err.message || 'Internal Server Error' });
});

async function initialize({ seedCount = 3000 } = {}) {
  // Connect to MongoDB and seed deterministic trades if DB empty
  await connectMongo();

  if (mongoose.connection.readyState === 1) {
    try {
      const Trade = require('./models/Trade');
      const existing = await Trade.countDocuments();
      if (existing === 0) {
        const seedTrades = generateDeterministicTrades(seedCount);
        const ops = seedTrades.map((t) => ({
          updateOne: { filter: { tradeId: t.tradeId }, update: { $setOnInsert: { ...t } }, upsert: true },
        }));
        if (ops.length) await Trade.bulkWrite(ops, { ordered: false });
        logger('info', 'seeded trades into mongo', { seedCount: seedTrades.length });
      } else {
        logger('info', 'mongo already has trades', { existing });
      }
    } catch (e) {
      logger('error', 'seeding trades failed', { error: String(e) });
      throw e;
    }
  }
}

module.exports = { app, connectMongo, jobs, buildPaginatedTrades, initialize };

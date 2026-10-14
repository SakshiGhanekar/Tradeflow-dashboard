// Dashboard backend (port 3000): ingestion + storage + REST + SSE push
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname)));
app.get('/', (_, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
const BSE_URL = process.env.BSE_URL || 'http://localhost:4000';
const SELF_URL = process.env.SELF_URL || `http://localhost:${PORT}`;
const DB_PATH = path.join(__dirname, 'data', 'trades.json');

const clients = new Set();

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

let store = {
  trades: {},
  lastPullAt: null,
};

let pull = {
  state: 'idle',
  jobId: null,
  startedAt: null,
  etaMs: null,
  error: null,
};

function loadStore() {
  try {
    const data = fs.readFileSync(DB_PATH, 'utf8');
    store = JSON.parse(data);
  } catch (error) {
    store = { trades: {}, lastPullAt: null };
  }
}

function saveStore() {
  fs.writeFileSync(DB_PATH, JSON.stringify(store, null, 2));
}

function getStatus() {
  return {
    ...pull,
    total: Object.keys(store.trades).length,
    lastPullAt: store.lastPullAt,
  };
}

function broadcast(eventName, payload) {
  for (const response of clients) {
    response.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
  }
}

function getSortedTrades(searchTerm = '', limit = 200, offset = 0) {
  let rows = Object.values(store.trades).sort((a, b) =>
    b.timestamp.localeCompare(a.timestamp)
  );

  if (searchTerm) {
    const term = String(searchTerm).toLowerCase();
    rows = rows.filter((trade) =>
      [trade.tradeId, trade.client, trade.symbol].some((value) =>
        String(value).toLowerCase().includes(term)
      )
    );
  }

  const start = Number(offset) || 0;
  const pageSize = Number(limit) || 200;

  return {
    total: rows.length,
    trades: rows.slice(start, start + pageSize),
  };
}

function getSummary() {
  const trades = Object.values(store.trades);
  const bySymbol = {};
  let notional = 0;

  for (const trade of trades) {
    const value = trade.quantity * trade.price;
    notional += value;
    bySymbol[trade.symbol] = (bySymbol[trade.symbol] || 0) + value;
  }

  return {
    count: trades.length,
    notional,
    bySymbol,
  };
}

async function startPull() {
  if (pull.state === 'pulling') {
    return false;
  }

  try {
    const response = await fetch(
      `${BSE_URL}/getTrades?callbackUrl=${encodeURIComponent(`${SELF_URL}/api/bse-callback`)}`,
      { signal: AbortSignal.timeout(10000) }
    );

    if (response.status !== 202) {
      throw new Error(`BSE returned ${response.status}`);
    }

    const payload = await response.json();
    pull = {
      state: 'pulling',
      jobId: payload.jobId,
      startedAt: new Date().toISOString(),
      etaMs: payload.etaMs,
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

  broadcast('status', getStatus());
  return pull.state === 'pulling';
}

app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  res.flushHeaders();
  res.write(`event: status\ndata: ${JSON.stringify(getStatus())}\n\n`);
  clients.add(res);

  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
});

app.get('/api/status', (_, res) => {
  res.json(getStatus());
});

app.get('/api/trades', (req, res) => {
  const { q = '', limit = 200, offset = 0 } = req.query;
  const payload = getSortedTrades(q, limit, offset);
  res.json(payload);
});

app.get('/api/summary', (_, res) => {
  res.json(getSummary());
});

app.post('/api/pull', async (_, res) => {
  const started = await startPull();
  res.status(202).json({ started });
});

app.post('/api/bse-callback', (req, res) => {
  const { jobId, trades = [] } = req.body;
  let added = 0;

  for (const trade of trades) {
    if (!store.trades[trade.tradeId]) {
      store.trades[trade.tradeId] = trade;
      added += 1;
    }
  }

  store.lastPullAt = new Date().toISOString();
  saveStore();

  pull = {
    state: 'idle',
    jobId: null,
    startedAt: null,
    etaMs: null,
    error: null,
  };

  console.log(`[ingest] ${jobId}: +${added} trades (total ${Object.keys(store.trades).length})`);
  broadcast('pull-complete', { added, ...getStatus() });
  res.sendStatus(200);

  if (process.env.AUTO_REPULL === '1') {
    startPull();
  }
});

loadStore();

app.listen(PORT, () => {
  console.log(`Dashboard on http://localhost:${PORT}`);
  startPull();
});

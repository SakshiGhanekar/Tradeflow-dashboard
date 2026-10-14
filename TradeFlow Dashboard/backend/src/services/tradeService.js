const fs = require('fs');
const path = require('path');

const dataDir = path.resolve(__dirname, '../../../data');
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

async function getTrades({ q = '', limit = 200, offset = 0 }) {
  loadStore();
  let rows = Object.values(store.trades).sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  if (q) {
    const search = String(q).toLowerCase();
    rows = rows.filter((trade) =>
      [trade.tradeId, trade.client, trade.symbol].some((value) =>
        String(value).toLowerCase().includes(search)
      )
    );
  }

  const start = Number(offset) || 0;
  const pageSize = Number(limit) || 200;

  return { total: rows.length, trades: rows.slice(start, start + pageSize) };
}

async function getSummary() {
  loadStore();
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

async function startPull() {
  if (pull.state === 'pulling') return false;

  const BSE_URL = process.env.BSE_URL || 'http://localhost:4000';
  const PORT = Number(process.env.PORT || 3001);

  try {
    const response = await fetch(
      `${BSE_URL}/getTrades?callbackUrl=${encodeURIComponent(`http://localhost:${PORT}/api/bse-callback`)}`,
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
      etaMs: payload.etaMs || 900000,
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

  return pull.state === 'pulling';
}

async function handleBseCallback(payload = {}) {
  loadStore();
  const { jobId, trades = [] } = payload;
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
  return { added, ...buildStatus() };
}

module.exports = {
  getTrades,
  getSummary,
  startPull,
  handleBseCallback,
  buildStatus,
};

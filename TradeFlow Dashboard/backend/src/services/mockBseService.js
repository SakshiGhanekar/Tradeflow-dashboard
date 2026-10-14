const { randomUUID } = require('crypto');

const DEFAULT_DELAY_MS = Number(process.env.PULL_DELAY_MS || 15 * 60 * 1000);
const BASE_TRADE_COUNT = Number(process.env.SEED_TRADES || 3000);
const GROWTH_PER_PULL = Number(process.env.GROWTH_PER_PULL || 200);

const SYMBOLS = ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'SBIN', 'ITC', 'LT', 'WIPRO', 'AXISBANK'];
const CLIENTS = ['Arham Capital', 'Nirav & Co', 'Sunrise Funds', 'Kalpana Traders', 'Orbit Securities', 'Bluechip PMS'];

function createSeededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6D2B79F5) >>> 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildTrade(index) {
  const random = createSeededRandom(index * 7919 + 13);
  return {
    tradeId: `T${String(index + 1).padStart(7, '0')}`,
    client: CLIENTS[Math.floor(random() * CLIENTS.length)],
    symbol: SYMBOLS[Math.floor(random() * SYMBOLS.length)],
    quantity: Math.max(10, Math.ceil(random() * 500)),
    price: Number((100 + random() * 3900).toFixed(2)),
    timestamp: new Date(Date.UTC(2026, 9, 1) + index * 45000).toISOString(),
  };
}

function buildTradeBatch(pullCount = 0) {
  const totalTrades = BASE_TRADE_COUNT + pullCount * GROWTH_PER_PULL;
  return Array.from({ length: totalTrades }, (_, index) => buildTrade(index));
}

async function fetchTradesFromMockBse({ callbackUrl, delayMs = DEFAULT_DELAY_MS, jobId = randomUUID(), pullCount = 0 } = {}) {
  const safeDelayMs = Number(delayMs) || DEFAULT_DELAY_MS;
  const response = {
    jobId,
    status: 'accepted',
    etaMs: safeDelayMs,
    trades: buildTradeBatch(pullCount),
  };

  setTimeout(async () => {
    try {
      await fetch(callbackUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId, trades: response.trades }),
      });
    } catch (error) {
      console.error('[mock-bse] callback failed:', error.message);
    }
  }, safeDelayMs);

  return response;
}

module.exports = {
  fetchTradesFromMockBse,
  buildTradeBatch,
  DEFAULT_DELAY_MS,
};

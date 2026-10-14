// Mock BSE Exchange API (port 4000)
// GET /getTrades            -> waits PULL_DELAY_MS then responds (the "naive" blocking mode; dies behind a 30s proxy)
// GET /getTrades?callbackUrl=... -> responds 202 immediately, POSTs the trades to callbackUrl after PULL_DELAY_MS
const express = require('express');

const app = express();
const PORT = process.env.BSE_PORT || 4000;
const DEV_DELAY_MS = Number(process.env.PULL_DELAY_MS ?? 15 * 60 * 1000);
const BASE_TRADE_COUNT = Number(process.env.SEED_TRADES || 3000);
const GROWTH_PER_PULL = Number(process.env.GROWTH_PER_PULL || 200);
const SYMBOLS = ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'SBIN', 'ITC', 'LT', 'WIPRO', 'AXISBANK'];
const CLIENTS = ['Arham Capital', 'Nirav & Co', 'Sunrise Funds', 'Kalpana Traders', 'Orbit Securities', 'Bluechip PMS'];

let pullCounter = 0;

function createSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createTrade(index) {
  const random = createSeededRandom(index * 7919 + 13);
  const symbol = SYMBOLS[Math.floor(random() * SYMBOLS.length)];
  const client = CLIENTS[Math.floor(random() * CLIENTS.length)];

  return {
    tradeId: `T${String(index + 1).padStart(7, '0')}`,
    client,
    symbol,
    quantity: Math.max(10, Math.ceil(random() * 500)),
    price: Number((100 + random() * 3900).toFixed(2)),
    timestamp: new Date(Date.UTC(2026, 9, 1) + index * 45000).toISOString(),
  };
}

function buildTradeSnapshot() {
  const totalTrades = BASE_TRADE_COUNT + pullCounter * GROWTH_PER_PULL;
  return Array.from({ length: totalTrades }, (_, index) => createTrade(index));
}

function sendDelayedCallback(jobId, callbackUrl) {
  setTimeout(async () => {
    pullCounter += 1;

    try {
      const response = await fetch(callbackUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jobId,
          trades: buildTradeSnapshot(),
        }),
      });

      console.log(`[bse] ${jobId} delivered (${response.status})`);
    } catch (error) {
      console.error(`[bse] ${jobId} delivery failed:`, error.message);
    }
  }, DEV_DELAY_MS);
}

app.get('/getTrades', (req, res) => {
  const { callbackUrl } = req.query;
  const jobId = `job-${Date.now()}`;

  console.log(`[bse] pull requested ${jobId} (delay ${DEV_DELAY_MS}ms, callback=${!!callbackUrl})`);

  const responsePayload = {
    jobId,
    status: 'accepted',
    etaMs: DEV_DELAY_MS,
  };

  if (!callbackUrl) {
    return res.status(202).json(responsePayload);
  }

  res.status(202).json(responsePayload);
  sendDelayedCallback(jobId, callbackUrl);
});

app.get('/health', (_, res) => {
  res.json({ status: 'ok', port: PORT, pullDelayMs: DEV_DELAY_MS });
});

app.listen(PORT, () => {
  console.log(`Mock BSE on :${PORT}, pull delay ${DEV_DELAY_MS / 1000}s`);
  console.log(`Seed trade count: ${BASE_TRADE_COUNT}`);
});

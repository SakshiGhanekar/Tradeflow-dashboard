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

function generateDeterministicTrades(count = 3000) {
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error('Trade count must be a positive integer');
  }

  const trades = Array.from({ length: count }, (_, index) => buildTrade(index));
  const seen = new Set();
  const uniqueTrades = [];

  for (const trade of trades) {
    if (!seen.has(trade.tradeId)) {
      seen.add(trade.tradeId);
      uniqueTrades.push(trade);
    }
  }

  return uniqueTrades;
}

module.exports = {
  generateDeterministicTrades,
  buildTrade,
};

const TradeService = require('../services/tradeService');

async function getTrades(req, res) {
  const { q = '', limit = 200, offset = 0 } = req.query;
  const result = await TradeService.getTrades({ q, limit, offset });
  res.json(result);
}

async function getSummary(_, res) {
  const summary = await TradeService.getSummary();
  res.json(summary);
}

async function triggerPull(_, res) {
  const result = await TradeService.startPull();
  res.status(202).json({ started: result });
}

async function handleBseCallback(req, res) {
  await TradeService.handleBseCallback(req.body || {});
  res.sendStatus(200);
}

async function streamHealth(_, res) {
  res.json({ status: 'ok' });
}

module.exports = {
  getTrades,
  getSummary,
  triggerPull,
  handleBseCallback,
  streamHealth,
};

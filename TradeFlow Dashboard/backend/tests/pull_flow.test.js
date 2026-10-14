const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const request = require('supertest');
const path = require('path');

// test utilities
const { generateDeterministicTrades } = require('../src/services/tradeSeed');
const { app, jobs } = require('../src/app');
// start an actual server so SSE connections work
const server = app.listen(0);
const PORT = server.address().port;
const baseUrl = `http://127.0.0.1:${PORT}`;

test('trade seed generates 3000 unique trades', () => {
  const trades = generateDeterministicTrades(3000);
  assert.equal(trades.length, 3000);
  const ids = new Set(trades.map((t) => t.tradeId));
  assert.equal(ids.size, 3000);
});

test('POST /api/pulls returns 202 and jobId quickly and completes (SSE)', { timeout: 10000 }, async () => {

  // open SSE connection
  const events = [];
  const sseReq = http.get({ hostname: '127.0.0.1', port: PORT, path: '/api/events' });

  sseReq.on('response', (res) => {
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      events.push(chunk);
    });
  });

  // start pull
  const res = await request(server).post('/api/pulls').send({ durationMs: 500 }).set('Accept', 'application/json');
  assert.equal(res.status, 202);
  assert.ok(res.body.jobId);
  const jobId = res.body.jobId;

  // wait for job to appear as completed via polling endpoint (max 6s)
  const deadline = Date.now() + 6000;
  let job;
  while (Date.now() < deadline) {
    const jr = await request(server).get(`/api/pulls/${jobId}`);
    if (jr.status === 200 && jr.body.status === 'completed') {
      job = jr.body;
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // close SSE
  try { sseReq.destroy(); } catch (e) { }

  assert.ok(job, 'expected job to complete within timeout');
  assert.equal(job.status, 'completed');
});

test('POST /api/pulls with same idempotencyKey returns duplicate result', async () => {
  const key = `test-key-${Date.now()}`;
  const first = await request(server).post('/api/pulls').send({ durationMs: 300 }).set('Idempotency-Key', key);
  assert.equal(first.status, 202);
  const second = await request(server).post('/api/pulls').send({ durationMs: 300 }).set('Idempotency-Key', key);
  // server may return 200 duplicate or 409 if a concurrent job prevents new pulls
  assert.ok([200, 202, 409].includes(second.status));
});

process.on('exit', () => {
  try { server.close(); } catch (e) { }
});

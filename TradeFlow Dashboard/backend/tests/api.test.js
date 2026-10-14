const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app } = require('../src/app.js');

test('GET /api/health returns status and database details', async () => {
  const response = await request(app).get('/api/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.ok(response.body.database);
});

test('GET /getTrades returns paginated trade data with metadata', async () => {
  const response = await request(app).get('/getTrades?page=1&limit=10');
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body.trades));
  assert.ok(Number.isInteger(response.body.total));
  assert.ok(Number.isInteger(response.body.page));
  assert.ok(Number.isInteger(response.body.limit));
});

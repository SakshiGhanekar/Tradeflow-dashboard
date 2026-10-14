import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../server/index.js';

describe('API smoke tests', () => {
  it('should return health status', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  it('should return empty trade list when no trades exist', async () => {
    const response = await request(app).get('/api/trades');
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.trades)).toBe(true);
  });
});

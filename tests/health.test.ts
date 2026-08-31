import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app.js';

describe('Health Endpoints', () => {
  it('GET /health returns 200 { status: "ok" } (root liveness probe)', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    // Verify no internal environment or secret leaks
    expect(response.body).not.toHaveProperty('DATABASE_URL');
    expect(response.body).not.toHaveProperty('JWT_SECRET');
  });

  it('GET /api/v1/health returns 200 with database check (readiness probe)', async () => {
    const response = await request(app).get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      api: 'ok',
      database: 'reachable',
    });
    // Verify no secret leaks
    expect(response.body).not.toHaveProperty('DATABASE_URL');
    expect(response.body).not.toHaveProperty('JWT_SECRET');
  });
});

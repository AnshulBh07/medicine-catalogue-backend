import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app.js';

describe('CORS configuration', () => {
  it('allows GET requests from the configured Expo Web development origin', async () => {
    const response = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:8081');

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:8081');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('allows alternative local Expo Web loopback origin', async () => {
    const response = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'http://127.0.0.1:8081');

    expect(response.headers['access-control-allow-origin']).toBe('http://127.0.0.1:8081');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('handles preflight OPTIONS requests for authenticated endpoints and content-type headers', async () => {
    const response = await request(app)
      .options('/api/v1/auth/login')
      .set('Origin', 'http://localhost:8081')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Content-Type, Authorization');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:8081');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['access-control-allow-methods']).toContain('POST');
    expect(response.headers['access-control-allow-headers']).toMatch(/content-type/i);
    expect(response.headers['access-control-allow-headers']).toMatch(/authorization/i);
  });

  it('does NOT allow unauthorized or unconfigured origins', async () => {
    const response = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'http://malicious-website.com');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-origin']).not.toBe('*');
    expect(response.headers['access-control-allow-origin']).not.toBe('http://malicious-website.com');
  });

  it('does NOT return CORS headers on preflight OPTIONS from unauthorized origins', async () => {
    const response = await request(app)
      .options('/api/v1/auth/login')
      .set('Origin', 'http://malicious-website.com')
      .set('Access-Control-Request-Method', 'POST');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows requests without an Origin header (mobile native / curl / server-to-server)', async () => {
    const response = await request(app).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});

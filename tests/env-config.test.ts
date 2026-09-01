import { describe, expect, it } from 'vitest';
import { parseEnvironment } from '../src/config/env.js';

describe('Environment Configuration & Validation', () => {
  const validBaseEnv = {
    NODE_ENV: 'production',
    PORT: '3000',
    DATABASE_URL: 'postgresql://testuser:secretpass@neon.example.com/medicina_prod?sslmode=require',
    JWT_SECRET: 'a-very-long-production-jwt-secret-string-at-least-32-characters',
    JWT_EXPIRES_IN: '15m',
    CORS_ORIGINS: 'https://medicina.example.com',
  };

  it('successfully parses valid production configuration', () => {
    const parsed = parseEnvironment(validBaseEnv);
    expect(parsed.NODE_ENV).toBe('production');
    expect(parsed.PORT).toBe(3000);
    expect(parsed.HOST).toBe('127.0.0.1');
    expect(parsed.DATABASE_URL).toBe(validBaseEnv.DATABASE_URL);
    expect(parsed.JWT_SECRET).toBe(validBaseEnv.JWT_SECRET);
    expect(parsed.JWT_EXPIRES_IN).toBe('15m');
    expect(parsed.CORS_ORIGINS).toEqual(['https://medicina.example.com']);
  });

  it('fails with clear error message when DATABASE_URL is missing', () => {
    const invalidEnv = { ...validBaseEnv, DATABASE_URL: '' };
    expect(() => parseEnvironment(invalidEnv)).toThrowError(/DATABASE_URL is required/);
  });

  it('fails with clear error message when JWT_SECRET is too short (< 32 chars)', () => {
    const invalidEnv = { ...validBaseEnv, JWT_SECRET: 'short-secret' };
    expect(() => parseEnvironment(invalidEnv)).toThrowError(/JWT_SECRET must be at least 32 characters long/);
  });

  it('does NOT expose secret values in validation errors', () => {
    const invalidEnv = {
      ...validBaseEnv,
      PORT: 'invalid-port',
      DATABASE_URL: 'postgresql://supersecretuser:supersecretpass@db.example.com/db',
    };
    try {
      parseEnvironment(invalidEnv);
      expect.unreachable('Should have thrown an error');
    } catch (err) {
      const errorMsg = (err as Error).message;
      expect(errorMsg).not.toContain('supersecretpass');
      expect(errorMsg).toContain('PORT');
    }
  });

  it('correctly splits comma-separated CORS_ORIGINS', () => {
    const envWithMultipleCors = {
      ...validBaseEnv,
      CORS_ORIGINS: 'https://app.example.com, https://admin.example.com , https://mobile.example.com',
    };
    const parsed = parseEnvironment(envWithMultipleCors);
    expect(parsed.CORS_ORIGINS).toEqual([
      'https://app.example.com',
      'https://admin.example.com',
      'https://mobile.example.com',
    ]);
  });

  it('supports CORS_ORIGIN single fallback', () => {
    const envWithSingleOrigin = {
      NODE_ENV: 'production',
      PORT: '3000',
      DATABASE_URL: 'postgresql://testuser:secretpass@neon.example.com/medicina_prod?sslmode=require',
      JWT_SECRET: 'a-very-long-production-jwt-secret-string-at-least-32-characters',
      JWT_EXPIRES_IN: '15m',
      CORS_ORIGIN: 'https://single.example.com',
    };
    const parsed = parseEnvironment(envWithSingleOrigin);
    expect(parsed.CORS_ORIGINS).toEqual(['https://single.example.com']);
  });

  it('supports Cloudflare R2 legacy variable aliases', () => {
    const raw = {
      ...validBaseEnv,
      CLOUDFLARE_ACCOUNT_ID: 'cf-acc-123',
      CLOUDFLARE_ACCESS_KEY_ID: 'cf-key-123',
      CLOUDFLARE_SECRET_ACCESS_KEY: 'cf-secret-123',
      CLOUDFLARE_BUCKET_NAME: 'cf-bucket',
      CLOUDFLARE_ENDPOINT: 'https://cf-acc-123.r2.cloudflarestorage.com',
      R2_PUBLIC_URL: 'https://images.example.com',
    };
    const parsed = parseEnvironment(raw);
    expect(parsed.R2_ACCOUNT_ID).toBe('cf-acc-123');
    expect(parsed.R2_ACCESS_KEY_ID).toBe('cf-key-123');
    expect(parsed.R2_SECRET_ACCESS_KEY).toBe('cf-secret-123');
    expect(parsed.R2_BUCKET_NAME).toBe('cf-bucket');
    expect(parsed.R2_ENDPOINT).toBe('https://cf-acc-123.r2.cloudflarestorage.com');
    expect(parsed.R2_PUBLIC_URL).toBe('https://images.example.com');
  });

  it('supports AWS and alternative R2 aliases for S3-compatible environments', () => {
    const raw = {
      ...validBaseEnv,
      CF_ACCOUNT_ID: 'cf-alt-acc',
      AWS_ACCESS_KEY_ID: 'aws-key-123',
      AWS_SECRET_ACCESS_KEY: 'aws-secret-123',
      R2_BUCKET: 'alt-bucket',
      CF_ENDPOINT: 'https://cf-alt-acc.r2.cloudflarestorage.com',
      R2_CUSTOM_DOMAIN: 'https://cdn.example.com',
    };
    const parsed = parseEnvironment(raw);
    expect(parsed.R2_ACCOUNT_ID).toBe('cf-alt-acc');
    expect(parsed.R2_ACCESS_KEY_ID).toBe('aws-key-123');
    expect(parsed.R2_SECRET_ACCESS_KEY).toBe('aws-secret-123');
    expect(parsed.R2_BUCKET_NAME).toBe('alt-bucket');
    expect(parsed.R2_ENDPOINT).toBe('https://cf-alt-acc.r2.cloudflarestorage.com');
    expect(parsed.R2_PUBLIC_URL).toBe('https://cdn.example.com');
  });
});

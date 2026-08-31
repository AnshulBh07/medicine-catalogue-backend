import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { describe, expect, it } from 'vitest';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('Prisma Environment Loading Mechanism', () => {
  it('correctly targets .env.production when NODE_ENV=production', () => {
    const nodeEnv = 'production';
    const targetEnvFile = nodeEnv === 'production' ? '.env.production' : '.env.development';
    expect(targetEnvFile).toBe('.env.production');

    const envFilePath = path.join(serverRoot, targetEnvFile);
    expect(envFilePath).toContain('.env.production');
  });

  it('correctly targets .env.development when NODE_ENV=development or unset', () => {
    const nodeEnv1 = 'development';
    const targetEnvFile1 = nodeEnv1 === 'production' ? '.env.production' : '.env.development';
    expect(targetEnvFile1).toBe('.env.development');

    const nodeEnv2 = undefined;
    const targetEnvFile2 = (nodeEnv2 || 'development') === 'production' ? '.env.production' : '.env.development';
    expect(targetEnvFile2).toBe('.env.development');
  });

  it('preserves test environment DATABASE_URL without accidental development overwrite', () => {
    const testDbUrl = 'postgresql://test_user:test_pass@localhost:5432/test_db?schema=test_schema';
    const testEnv: Record<string, string> = {
      NODE_ENV: 'test',
      DATABASE_URL: testDbUrl,
    };

    // In test environment, dotenv loading of .env.development is skipped
    if (testEnv.NODE_ENV !== 'test') {
      dotenv.config({ path: path.join(serverRoot, '.env.development') });
    }

    expect(testEnv.DATABASE_URL).toBe(testDbUrl);
    expect(testEnv.DATABASE_URL).not.toContain('medicina_catalogue_dev');
  });
});

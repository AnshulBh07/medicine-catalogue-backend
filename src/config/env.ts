import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requestedEnvironment =
  process.env.NODE_ENV === 'production'
    ? 'production'
    : process.env.NODE_ENV === 'test'
      ? 'test'
      : 'development';

if (requestedEnvironment !== 'test') {
  dotenv.config({
    path: path.join(serverRoot, `.env.${requestedEnvironment}`),
  });
  dotenv.config({
    path: path.join(serverRoot, '.env'),
  });
}

const defaultDevCorsOrigins = 'http://localhost:8081,http://127.0.0.1:8081';

export const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default(requestedEnvironment),
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().trim().optional(),
    DATABASE_URL: z
      .string()
      .min(1, 'DATABASE_URL is required'),
    JWT_SECRET: z
      .string()
      .min(32, 'JWT_SECRET must be at least 32 characters long'),
    JWT_EXPIRES_IN: z
      .string()
      .min(1, 'JWT_EXPIRES_IN is required')
      .default('15m'),
    CORS_ORIGINS: z
      .string()
      .default(requestedEnvironment === 'production' ? '' : defaultDevCorsOrigins)
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0),
      ),
    R2_ACCOUNT_ID: z.string().trim().optional(),
    R2_ACCESS_KEY_ID: z.string().trim().optional(),
    R2_SECRET_ACCESS_KEY: z.string().trim().optional(),
    R2_BUCKET_NAME: z.string().trim().optional(),
    R2_ENDPOINT: z.string().trim().optional(),
    R2_PUBLIC_URL: z.string().trim().optional(),
  })
  .transform((data) => ({
    ...data,
    HOST: data.HOST || (data.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0'),
  }));

export const parseEnvironment = (raw: Record<string, unknown> = process.env) => {
  const payload = {
    NODE_ENV: raw.NODE_ENV,
    PORT: raw.PORT,
    HOST: raw.HOST,
    DATABASE_URL: raw.DATABASE_URL,
    JWT_SECRET: raw.JWT_SECRET,
    JWT_EXPIRES_IN: raw.JWT_EXPIRES_IN,
    CORS_ORIGINS: raw.CORS_ORIGINS ?? raw.CORS_ORIGIN,
    R2_ACCOUNT_ID: raw.R2_ACCOUNT_ID ?? raw.CLOUDFLARE_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: raw.R2_ACCESS_KEY_ID ?? raw.CLOUDFLARE_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: raw.R2_SECRET_ACCESS_KEY ?? raw.CLOUDFLARE_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME: raw.R2_BUCKET_NAME ?? raw.CLOUDFLARE_BUCKET_NAME,
    R2_ENDPOINT: raw.R2_ENDPOINT ?? raw.CLOUDFLARE_ENDPOINT,
    R2_PUBLIC_URL: raw.R2_PUBLIC_URL,
  };

  const parsed = environmentSchema.safeParse(payload);
  if (!parsed.success) {
    const errorDetails = parsed.error.issues
      .map((issue) => {
        const field = issue.path.join('.') || 'Configuration';
        return ` - ${field}: ${issue.message}`;
      })
      .join('\n');

    console.error(`[CONFIG ERROR] Invalid environment configuration:\n${errorDetails}`);
    throw new Error(`Invalid environment configuration:\n${errorDetails}`);
  }

  return parsed.data;
};

export const env = parseEnvironment();
export type Environment = typeof env;

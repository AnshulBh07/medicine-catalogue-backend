import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requestedEnvironment = process.env.NODE_ENV === 'production' ? 'production' : 'development';

dotenv.config({
  path: path.join(serverRoot, `.env.${requestedEnvironment}`),
});

const defaultDevCorsOrigins = 'http://localhost:8081,http://127.0.0.1:8081';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default(requestedEnvironment),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().min(1),
  CORS_ORIGINS: z
    .string()
    .default(requestedEnvironment === 'production' ? '' : defaultDevCorsOrigins)
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_ENDPOINT: z.string().optional(),
  R2_PUBLIC_URL: z.string().optional(),
});

export const env = environmentSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN,
  CORS_ORIGINS: process.env.CORS_ORIGINS ?? process.env.CORS_ORIGIN,
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID,
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID ?? process.env.CLOUDFLARE_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY ?? process.env.CLOUDFLARE_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME: process.env.R2_BUCKET_NAME ?? process.env.CLOUDFLARE_BUCKET_NAME,
  R2_ENDPOINT: process.env.R2_ENDPOINT ?? process.env.CLOUDFLARE_ENDPOINT,
  R2_PUBLIC_URL: process.env.R2_PUBLIC_URL,
});

import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, env } from 'prisma/config';

const serverRoot = path.dirname(fileURLToPath(import.meta.url));

// Explicit and deterministic environment selection based on NODE_ENV
const nodeEnv = process.env.NODE_ENV === 'production' ? 'production' : (process.env.NODE_ENV || 'development');

if (nodeEnv !== 'test') {
  // Load target environment file (.env.production or .env.development)
  dotenv.config({
    path: path.join(serverRoot, `.env.${nodeEnv}`),
  });
  // Fallback to base .env if present and variable is not yet populated
  dotenv.config({
    path: path.join(serverRoot, '.env'),
  });
}

export default defineConfig({
  schema: path.join(serverRoot, 'prisma', 'schema.prisma'),
  datasource: {
    url: env('DATABASE_URL'),
  },
});

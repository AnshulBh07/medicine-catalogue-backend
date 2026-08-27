import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, env } from 'prisma/config';

const serverRoot = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({
  path: path.join(serverRoot, '.env.development'),
  override: process.env.NODE_ENV !== 'test',
});

export default defineConfig({
  schema: path.join(serverRoot, 'prisma', 'schema.prisma'),
  datasource: {
    url: env('DATABASE_URL'),
  },
});

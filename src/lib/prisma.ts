import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client/index';
import { env } from '../config/env.js';

const databaseUrl = new URL(env.DATABASE_URL);
const adapter = new PrismaPg(
  { connectionString: env.DATABASE_URL },
  databaseUrl.searchParams.get('schema')
    ? { schema: databaseUrl.searchParams.get('schema') ?? undefined }
    : undefined,
);

export const prisma = new PrismaClient({ adapter });

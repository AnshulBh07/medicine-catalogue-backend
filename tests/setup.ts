import path from 'node:path';
import dotenv from 'dotenv';
const testSchema = 'codex_api_integration';
const serverRoot = path.resolve(import.meta.dirname, '..');

dotenv.config({ path: path.join(serverRoot, '.env.development') });

const developmentDatabaseUrl = process.env.DATABASE_URL;
if (!developmentDatabaseUrl) {
  throw new Error('DATABASE_URL is required for integration tests');
}

const testDatabaseUrl = new URL(developmentDatabaseUrl);
testDatabaseUrl.searchParams.set('schema', testSchema);
testDatabaseUrl.searchParams.set('options', `-c search_path=${testSchema}`);
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl.toString();

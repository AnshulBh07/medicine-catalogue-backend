import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';

const execFileAsync = promisify(execFile);
const testSchema = 'codex_api_integration';
const serverRoot = path.resolve(import.meta.dirname, '..');

export default async function globalSetup(): Promise<() => Promise<void>> {
  dotenv.config({ path: path.join(serverRoot, '.env.development') });
  const developmentDatabaseUrl = process.env.DATABASE_URL;
  if (!developmentDatabaseUrl) {
    throw new Error('DATABASE_URL is required for integration tests');
  }

  const testDatabaseUrl = new URL(developmentDatabaseUrl);
  testDatabaseUrl.searchParams.set('schema', testSchema);
  testDatabaseUrl.searchParams.set('options', `-c search_path=${testSchema}`);
  const adminClient = new pg.Client({ connectionString: developmentDatabaseUrl });
  await adminClient.connect();
  await adminClient.query(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
  await adminClient.query(`CREATE SCHEMA "${testSchema}"`);

  const isWindows = process.platform === 'win32';
  const npxCommand = isWindows ? 'npx.cmd' : 'npx';

  try {
    await execFileAsync(npxCommand, ['prisma', 'migrate', 'deploy'], {
      cwd: serverRoot,
      env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: testDatabaseUrl.toString(), TERM: 'xterm' },
      shell: isWindows,
    });
  } catch (error) {
    await adminClient.query(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
    await adminClient.end();
    throw error;
  }

  return async () => {
    await adminClient.query(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
    await adminClient.end();
  };
}

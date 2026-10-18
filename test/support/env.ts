import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Loads .env.test into process.env. By default existing values win; with `override` the test file wins,
 * which SIT needs because some libraries (e.g. @prisma/client) auto-load the developer .env on import.
 */
export function loadTestEnv(options: { override?: boolean } = {}): void {
  const file = path.resolve(__dirname, '..', '..', '.env.test');
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && (options.override || process.env[m[1]] === undefined))
      process.env[m[1]] = m[2];
  }
}

/** Applies migrations to the test database. Idempotent. */
export function migrateTestDb(): void {
  loadTestEnv();
  execSync('npx prisma migrate deploy', { stdio: 'pipe', env: process.env });
}

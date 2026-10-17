// Runs before every unit test file. Loads .env.test so modules that validate the environment at import
// time (ConfigModule) see a complete, non-secret configuration pointing at the docker infrastructure.
import * as fs from 'node:fs';
import * as path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.ENV_FILE = process.env.ENV_FILE ?? '.env.test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';

const file = path.resolve(__dirname, '..', '.env.test');
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

/* Jest globalSetup for SIT: waits for docker infra, migrates the SIT database, resets WireMock. */
import { execSync } from 'node:child_process';
import { loadTestEnv } from '../../support/env';
import { wiremock } from './wiremock';

async function waitFor(
  name: string,
  check: () => Promise<boolean>,
  attempts = 30,
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${name} did not become ready. Run \`make up\` first.`);
}

export default async function globalSetup(): Promise<void> {
  loadTestEnv();
  process.env.ENV_FILE = '.env.test';
  await waitFor('wiremock', () => wiremock.healthy());
  await waitFor(
    'postgres',
    () => {
      try {
        execSync('npx prisma migrate deploy', {
          stdio: 'pipe',
          env: process.env,
        });
        return Promise.resolve(true);
      } catch {
        return Promise.resolve(false);
      }
    },
    10,
  );
  await wiremock.reset();
}

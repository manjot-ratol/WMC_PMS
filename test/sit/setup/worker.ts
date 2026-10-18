import type { INestApplicationContext } from '@nestjs/common';
import { createWorkerContext } from '../../../src/app/bootstrap';
import { loadTestEnv } from '../../support/env';

/** Boots the real worker (BullMQ consumers + outbox dispatcher) in-process for SIT. */
export async function startSitWorker(): Promise<{
  ctx: INestApplicationContext;
  stop: () => Promise<void>;
}> {
  loadTestEnv({ override: true });
  process.env.ENV_FILE = '.env.test';
  const ctx = await createWorkerContext();
  return { ctx, stop: () => ctx.close() };
}

/** Polls `fn` until it returns a truthy value or the timeout elapses. */
export async function eventually<T>(
  fn: () => Promise<T | null | undefined | false>,
  timeoutMs = 20_000,
  everyMs = 250,
): Promise<T> {
  const started = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - started > timeoutMs)
      throw new Error('eventually: timed out');
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

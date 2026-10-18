import type { INestApplicationContext } from '@nestjs/common';
import { createWorkerContext } from '../../../src/app/bootstrap';
import { loadTestEnv } from '../../support/env';
import { createTrackWizzMock } from './trackwizz';
import type { TrackWizzMock } from '../../../src/infrastructure/partners/trackwizz/trackwizz-mock.server';
import { MfCentralMock } from '../../../src/infrastructure/partners/mfcentral/mfcentral-mock.server';

/** Boots the real worker (BullMQ consumers + outbox dispatcher) in-process for SIT, with the TrackWizz and MF Central mocks beside it. */
export async function startSitWorker(): Promise<{
  ctx: INestApplicationContext;
  trackwizz: TrackWizzMock;
  mfcentral: MfCentralMock;
  stop: () => Promise<void>;
}> {
  loadTestEnv({ override: true });
  process.env.ENV_FILE = '.env.test';
  const trackwizz = createTrackWizzMock();
  await trackwizz.start();
  const mfcentral = new MfCentralMock({
    port: Number(
      new URL(process.env.MFCENTRAL_BASE_URL ?? 'http://127.0.0.1:4011').port ||
        4011,
    ),
  });
  await mfcentral.start();
  const ctx = await createWorkerContext();
  return {
    ctx,
    trackwizz,
    mfcentral,
    stop: async () => {
      await ctx.close();
      await trackwizz.stop();
      await mfcentral.stop();
    },
  };
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

import { describeWithRedis, testRedis } from '../../../test/support/redis';
import {
  OUTBOX_BATCH_LIMIT,
  OUTBOX_TICK_EVERY_MS,
  OUTBOX_TICK_JOB,
  OutboxDispatcherScheduler,
} from './outbox-dispatcher.scheduler';
import { QueueRegistry } from './queue-registry';
import { QUEUES } from './queue.names';

describeWithRedis('QueueRegistry and scheduler (docker redis)', () => {
  it('creates one queue per name lazily and closes them', async () => {
    const redis = testRedis();
    const registry = new QueueRegistry(redis);
    const a = registry.get(QUEUES.SCREENING);
    expect(registry.get(QUEUES.SCREENING)).toBe(a);
    expect(registry.get(QUEUES.AML)).not.toBe(a);
    await registry.closeAll();
    await redis.quit();
  });

  it('scheduler registers the repeatable outbox tick with a stable jobId', async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const registry = {
      get: jest.fn().mockReturnValue({ add }),
    } as unknown as QueueRegistry;
    await new OutboxDispatcherScheduler(registry).onModuleInit();
    expect((registry.get as jest.Mock).mock.calls[0]).toEqual([QUEUES.OUTBOX]);
    expect(add).toHaveBeenCalledWith(
      OUTBOX_TICK_JOB,
      { correlationId: 'scheduler', payload: { limit: OUTBOX_BATCH_LIMIT } },
      expect.objectContaining({
        jobId: 'outbox-tick',
        repeat: { every: OUTBOX_TICK_EVERY_MS },
      }),
    );
  });
});

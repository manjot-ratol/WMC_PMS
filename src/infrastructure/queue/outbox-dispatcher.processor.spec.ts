import { CorrelationStore } from '../../common/correlation/correlation.store';
import { EventRouter } from './event-router';
import { OutboxDispatcherProcessor } from './outbox-dispatcher.processor';
import { QUEUES } from './queue.names';

describe('OutboxDispatcherProcessor', () => {
  const store = new CorrelationStore();
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(),
  };
  logger.child.mockReturnValue(logger);
  const outbox = {
    claimBatch: jest.fn(),
    markDispatched: jest.fn(),
    markFailed: jest.fn(),
    add: jest.fn(),
  };
  const publisher = { publish: jest.fn() };
  const router = new EventRouter();
  router.register('ScreeningRequested', {
    queue: QUEUES.SCREENING,
    jobName: 'run',
  });
  const processor = new OutboxDispatcherProcessor(
    store,
    logger as never,
    outbox,
    publisher,
    router,
  );

  beforeEach(() => jest.clearAllMocks());

  it('publishes routed events with the row id as jobId and marks them dispatched', async () => {
    outbox.claimBatch.mockResolvedValue([
      {
        id: 'ob-1',
        eventType: 'ScreeningRequested',
        aggregateType: 'application',
        aggregateId: 'app_1',
        payload: { x: 1 },
        correlationId: 'corr-x',
        createdAt: new Date(),
        attempts: 0,
      },
    ]);
    publisher.publish.mockResolvedValue(undefined);
    const result = await processor.handle({ limit: 50 });
    expect(publisher.publish).toHaveBeenCalledWith(
      QUEUES.SCREENING,
      'run',
      expect.objectContaining({
        aggregateId: 'app_1',
        eventType: 'ScreeningRequested',
        payload: { x: 1 },
      }),
      { jobId: 'ob-1' },
    );
    expect(outbox.markDispatched).toHaveBeenCalledWith('ob-1');
    expect(result).toEqual({ claimed: 1, dispatched: 1, failed: 0 });
  });

  it('marks unknown event types failed with a reason and continues', async () => {
    outbox.claimBatch.mockResolvedValue([
      {
        id: 'ob-2',
        eventType: 'Nope',
        aggregateType: 'a',
        aggregateId: '1',
        payload: {},
        correlationId: 'c',
        createdAt: new Date(),
        attempts: 0,
      },
      {
        id: 'ob-3',
        eventType: 'ScreeningRequested',
        aggregateType: 'a',
        aggregateId: '1',
        payload: {},
        correlationId: 'c',
        createdAt: new Date(),
        attempts: 0,
      },
    ]);
    publisher.publish.mockResolvedValue(undefined);
    const result = await processor.handle({ limit: 50 });
    expect(outbox.markFailed).toHaveBeenCalledWith(
      'ob-2',
      expect.stringMatching(/no route/i),
    );
    expect(outbox.markDispatched).toHaveBeenCalledWith('ob-3');
    expect(result).toEqual({ claimed: 2, dispatched: 1, failed: 1 });
  });

  it('returns zeros and logs nothing for an empty batch', async () => {
    outbox.claimBatch.mockResolvedValue([]);
    await expect(processor.handle({ limit: 50 })).resolves.toEqual({
      claimed: 0,
      dispatched: 0,
      failed: 0,
    });
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('stringifies non-Error publish rejections', async () => {
    outbox.claimBatch.mockResolvedValue([
      {
        id: 'ob-5',
        eventType: 'ScreeningRequested',
        aggregateType: 'a',
        aggregateId: '1',
        payload: {},
        correlationId: 'c',
        createdAt: new Date(),
        attempts: 0,
      },
    ]);
    publisher.publish.mockRejectedValue('plain failure');
    await processor.handle({ limit: 50 });
    expect(outbox.markFailed).toHaveBeenCalledWith('ob-5', 'plain failure');
  });

  it('marks failed when publishing throws and runs each row under its own correlation id', async () => {
    outbox.claimBatch.mockResolvedValue([
      {
        id: 'ob-4',
        eventType: 'ScreeningRequested',
        aggregateType: 'a',
        aggregateId: '1',
        payload: {},
        correlationId: 'corr-row',
        createdAt: new Date(),
        attempts: 2,
      },
    ]);
    let seen = '';
    publisher.publish.mockImplementation(() => {
      seen = store.getCorrelationId();
      return Promise.reject(new Error('redis gone'));
    });
    await processor.handle({ limit: 50 });
    expect(seen).toBe('corr-row');
    expect(outbox.markFailed).toHaveBeenCalledWith('ob-4', 'redis gone');
  });
});

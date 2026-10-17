import { CorrelationStore } from '../../common/correlation/correlation.store';
import { BaseProcessor } from './base.processor';
import { BullJobPublisher } from './job-publisher';
import type { JobEnvelope } from './job-context';

class EchoProcessor extends BaseProcessor<{ v: number }> {
  seen: string[] = [];
  handle(payload: { v: number }): Promise<void> {
    this.seen.push(`${payload.v}:${this.store.getCorrelationId()}`);
    return Promise.resolve();
  }
}

describe('queue job context', () => {
  const store = new CorrelationStore();

  it('BaseProcessor restores the correlation id from the envelope', async () => {
    const p = new EchoProcessor(store);
    await p.process({
      id: 'job-1',
      name: 'n',
      data: { correlationId: 'corr-job', payload: { v: 7 } },
    } as never);
    expect(p.seen).toEqual(['7:corr-job']);
  });

  it('BaseProcessor tolerates a job without id', async () => {
    const p = new EchoProcessor(store);
    await p.process({
      name: 'n',
      data: { correlationId: 'c', payload: { v: 1 } },
    } as never);
    expect(p.seen).toEqual(['1:c']);
  });

  it('BullJobPublisher works without options', async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const publisher = new BullJobPublisher(store, {
      get: () => ({ add }),
    } as never);
    await publisher.publish('q', 'n', { a: 1 });
    expect(add).toHaveBeenCalledWith(
      'n',
      { correlationId: 'none', payload: { a: 1 } },
      expect.objectContaining({ jobId: undefined, delay: undefined }),
    );
  });

  it('BullJobPublisher wraps payload with the current correlation id and passes jobId', async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const queues = { get: jest.fn().mockReturnValue({ add }) };
    const publisher = new BullJobPublisher(store, queues as never);
    await store.run({ correlationId: 'corr-pub', requestId: 'r' }, () =>
      publisher.publish(
        'screening',
        'run',
        { a: 1 },
        { jobId: 'ob-1', delayMs: 10 },
      ),
    );
    expect(queues.get).toHaveBeenCalledWith('screening');
    const [name, data, opts] = add.mock.calls[0] as [
      string,
      JobEnvelope<unknown>,
      Record<string, unknown>,
    ];
    expect(name).toBe('run');
    expect(data).toEqual({ correlationId: 'corr-pub', payload: { a: 1 } });
    expect(opts).toMatchObject({
      jobId: 'ob-1',
      delay: 10,
      removeOnComplete: expect.anything() as unknown,
      attempts: expect.any(Number) as number,
    });
  });
});

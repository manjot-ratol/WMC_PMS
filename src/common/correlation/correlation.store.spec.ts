import { CorrelationStore } from './correlation.store';

describe('CorrelationStore', () => {
  const store = new CorrelationStore();

  it('returns the context inside run and undefined outside', () => {
    expect(store.get()).toBeUndefined();
    expect(store.getCorrelationId()).toBe('none');
    store.run({ correlationId: 'c1', requestId: 'r1' }, () => {
      expect(store.get()).toEqual({ correlationId: 'c1', requestId: 'r1' });
      expect(store.getCorrelationId()).toBe('c1');
    });
    expect(store.get()).toBeUndefined();
  });

  it('propagates across awaited async boundaries', async () => {
    const seen = await store.run(
      { correlationId: 'c2', requestId: 'r2' },
      async () => {
        await new Promise((r) => setTimeout(r, 5));
        return store.getCorrelationId();
      },
    );
    expect(seen).toBe('c2');
  });

  it('isolates concurrent contexts', async () => {
    const results = await Promise.all(
      ['a', 'b', 'c'].map((id) =>
        store.run({ correlationId: id, requestId: id }, async () => {
          await new Promise((r) => setTimeout(r, Math.random() * 10));
          return store.getCorrelationId();
        }),
      ),
    );
    expect(results).toEqual(['a', 'b', 'c']);
  });

  it('set() patches the current context', () => {
    store.run({ correlationId: 'c3', requestId: 'r3' }, () => {
      store.set({ principalId: 'cus_1' });
      expect(store.get()?.principalId).toBe('cus_1');
    });
    expect(() => store.set({ principalId: 'x' })).not.toThrow();
  });
});

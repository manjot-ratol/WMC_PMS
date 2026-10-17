import { EventRouter } from './event-router';

describe('EventRouter', () => {
  it('returns registered targets and undefined for unknown events', () => {
    const r = new EventRouter();
    r.register('A', { queue: 'q', jobName: 'j' });
    expect(r.route('A')).toEqual({ queue: 'q', jobName: 'j' });
    expect(r.route('B')).toBeUndefined();
  });
  it('rejects duplicate registration', () => {
    const r = new EventRouter();
    r.register('A', { queue: 'q', jobName: 'j' });
    expect(() => r.register('A', { queue: 'q2', jobName: 'j' })).toThrow(
      /already/,
    );
  });
});

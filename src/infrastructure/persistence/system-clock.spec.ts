import { CryptoIdGenerator, SystemClock } from './system-clock';

describe('SystemClock / CryptoIdGenerator', () => {
  it('now() is a current Date', () => {
    expect(
      Math.abs(new SystemClock().now().getTime() - Date.now()),
    ).toBeLessThan(1000);
  });
  it('ids are unique, prefixed and url-safe', () => {
    const g = new CryptoIdGenerator();
    expect(g.uuid()).not.toBe(g.uuid());
    const id = g.prefixed('app');
    expect(id).toMatch(/^app_[A-Za-z0-9_-]{16}$/);
  });
});

import { bullConnectionOptions } from './queue.module';

describe('bullConnectionOptions', () => {
  it('parses host, port, db and credentials so BullMQ owns its own connections', () => {
    expect(bullConnectionOptions('redis://localhost:6380/15')).toMatchObject({
      host: 'localhost',
      port: 6380,
      db: 15,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      tls: undefined,
    });
    expect(
      bullConnectionOptions('rediss://u%40x:p%3Aw@cache.internal/'),
    ).toMatchObject({
      host: 'cache.internal',
      port: 6379,
      db: 0,
      username: 'u@x',
      password: 'p:w',
      tls: {},
    });
  });
});

import { Writable } from 'node:stream';
import { CorrelationStore } from '../correlation/correlation.store';
import { AppLogger } from './logger.service';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(JSON.parse(chunk.toString('utf8')) as Record<string, unknown>);
      cb();
    },
  });
  return { lines, stream };
}

describe('AppLogger', () => {
  const store = new CorrelationStore();

  it('includes correlation, request and principal ids from the store', () => {
    const { lines, stream } = capture();
    const logger = new AppLogger(store, {
      level: 'debug',
      serviceName: 'svc',
      pretty: false,
      stream,
    });
    store.run(
      { correlationId: 'c1', requestId: 'r1', principalId: 'cus_1' },
      () => logger.info('hello', { a: 1 }),
    );
    expect(lines[0]).toMatchObject({
      msg: 'hello',
      correlationId: 'c1',
      requestId: 'r1',
      principalId: 'cus_1',
      a: 1,
      service: 'svc',
    });
  });

  it('uses "none" outside a context and redacts fields', () => {
    const { lines, stream } = capture();
    const logger = new AppLogger(store, {
      level: 'debug',
      serviceName: 'svc',
      pretty: false,
      stream,
    });
    logger.warn('x', { pan_no: 'ABCDE1234F', err: new Error('token=abc') });
    expect(lines[0].correlationId).toBe('none');
    expect(lines[0].pan_no).toBe('[REDACTED]');
    expect((lines[0].err as Record<string, unknown>).message).toBe(
      'token=[REDACTED]',
    );
  });

  it('child() stamps the module name', () => {
    const { lines, stream } = capture();
    const logger = new AppLogger(store, {
      level: 'debug',
      serviceName: 'svc',
      pretty: false,
      stream,
    }).child('KraGateway');
    logger.debug('d');
    logger.error('e');
    expect(lines[0].module).toBe('KraGateway');
    expect(lines[1].level).toBe(50);
  });

  it('implements the Nest LoggerService surface', () => {
    const { lines, stream } = capture();
    const logger = new AppLogger(store, {
      level: 'debug',
      serviceName: 'svc',
      pretty: false,
      stream,
    });
    logger.log('nest', 'Ctx');
    logger.verbose?.('v');
    expect(lines[0]).toMatchObject({ msg: 'nest', module: 'Ctx' });
  });

  it('exposes fatal and verbose for the framework', () => {
    const { lines, stream } = capture();
    const logger = new AppLogger(store, {
      level: 'trace',
      serviceName: 'svc',
      pretty: false,
      stream,
    });
    logger.fatal('f', 'Ctx');
    logger.verbose('v');
    expect(lines[0]).toMatchObject({ level: 60, msg: 'f', module: 'Ctx' });
    expect(lines[1]).toMatchObject({ level: 10, msg: 'v' });
  });

  it('builds a default logger without options', () => {
    expect(() => new AppLogger(store)).not.toThrow();
  });

  it('respects the level', () => {
    const { lines, stream } = capture();
    const logger = new AppLogger(store, {
      level: 'warn',
      serviceName: 'svc',
      pretty: false,
      stream,
    });
    logger.info('hidden');
    logger.warn('shown');
    expect(lines).toHaveLength(1);
  });
});

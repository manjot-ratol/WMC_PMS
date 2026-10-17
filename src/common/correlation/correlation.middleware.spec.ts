import { CorrelationMiddleware } from './correlation.middleware';
import { CorrelationStore } from './correlation.store';
import {
  CORRELATION_HEADER,
  isValidCorrelationId,
} from './correlation.constants';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function run(headers: Record<string, string>) {
  const store = new CorrelationStore();
  const mw = new CorrelationMiddleware(store);
  const req = { headers } as never;
  const res = { setHeader: jest.fn() } as never;
  let seen: string | undefined;
  mw.use(req, res, () => {
    seen = store.getCorrelationId();
  });
  return { seen, res: res as { setHeader: jest.Mock } };
}

describe('CorrelationMiddleware', () => {
  it('uses X-Correlation-ID when valid', () => {
    const { seen, res } = run({ 'x-correlation-id': 'abc-123' });
    expect(seen).toBe('abc-123');
    expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_HEADER, 'abc-123');
  });

  it('falls back to X-Request-ID', () => {
    expect(run({ 'x-request-id': 'req-9' }).seen).toBe('req-9');
  });

  it('generates a UUID v4 when absent', () => {
    expect(run({}).seen).toMatch(UUID_RE);
  });

  it('replaces an id longer than 128 chars or containing control bytes', () => {
    expect(run({ 'x-correlation-id': 'x'.repeat(129) }).seen).toMatch(UUID_RE);
    expect(run({ 'x-correlation-id': 'bad\nid' }).seen).toMatch(UUID_RE);
    expect(run({ 'x-correlation-id': 'has space' }).seen).toMatch(UUID_RE);
  });

  it('takes the first value of a repeated header', () => {
    const store = new CorrelationStore();
    const mw = new CorrelationMiddleware(store);
    let seen = '';
    mw.use(
      { headers: { 'x-correlation-id': ['first-1', 'second-2'] } } as never,
      { setHeader: jest.fn() } as never,
      () => {
        seen = store.getCorrelationId();
      },
    );
    expect(seen).toBe('first-1');
  });

  it('isValidCorrelationId accepts printable ASCII without spaces, 1-128 chars', () => {
    expect(isValidCorrelationId('ok_1.2-3')).toBe(true);
    expect(isValidCorrelationId('')).toBe(false);
    expect(isValidCorrelationId(42)).toBe(false);
    expect(isValidCorrelationId('ünïcode')).toBe(false);
  });
});

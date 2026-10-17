import type { ExecutionContext } from '@nestjs/common';
import { correlationIdFromContext } from './correlation.decorator';

const ctx = (header: unknown) =>
  ({
    switchToHttp: () => ({ getResponse: () => ({ getHeader: () => header }) }),
  }) as unknown as ExecutionContext;

describe('correlationIdFromContext', () => {
  it('reads the response header', () =>
    expect(correlationIdFromContext(ctx('abc'))).toBe('abc'));
  it('falls back to none', () =>
    expect(correlationIdFromContext(ctx(undefined))).toBe('none'));
});

import type { ExecutionContext } from '@nestjs/common';
import { UnauthenticatedError } from '../errors/app-error';
import { principalFromContext } from './principal.decorator';

const ctx = (req: unknown) =>
  ({
    switchToHttp: () => ({ getRequest: () => req }),
  }) as unknown as ExecutionContext;

describe('principalFromContext', () => {
  it('returns the principal set by a guard', () => {
    expect(
      principalFromContext(
        ctx({ principal: { kind: 'CUSTOMER', id: 'cus_1' } }),
      ),
    ).toEqual({ kind: 'CUSTOMER', id: 'cus_1' });
  });
  it('throws 401 when absent', () => {
    expect(() => principalFromContext(ctx({}))).toThrow(UnauthenticatedError);
  });
});

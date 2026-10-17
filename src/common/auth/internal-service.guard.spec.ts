import { ExecutionContext } from '@nestjs/common';
import { CorrelationStore } from '../correlation/correlation.store';
import { UnauthenticatedError } from '../errors/app-error';
import { InternalServiceGuard } from './internal-service.guard';
import type { Principal } from './principal';

function ctx(headers: Record<string, string>): {
  c: ExecutionContext;
  req: { headers: Record<string, string>; principal?: Principal };
} {
  const req = { headers } as {
    headers: Record<string, string>;
    principal?: Principal;
  };
  const c = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { c, req };
}

describe('InternalServiceGuard', () => {
  const store = new CorrelationStore();
  const guard = new InternalServiceGuard(
    { internalServiceToken: 'internal-token' },
    store,
  );

  it('accepts a valid token and sets an INTERNAL principal', () => {
    const { c, req } = ctx({ 'x-internal-token': 'internal-token' });
    expect(guard.canActivate(c)).toBe(true);
    expect(req.principal).toEqual({ kind: 'INTERNAL', id: 'internal' });
  });

  it('captures the reviewer id into the principal and correlation context', () => {
    const { c, req } = ctx({
      'x-internal-token': 'internal-token',
      'x-reviewer-id': 'rev_42',
    });
    store.run({ correlationId: 'c', requestId: 'r' }, () => {
      expect(guard.canActivate(c)).toBe(true);
      expect(req.principal).toEqual({
        kind: 'REVIEWER',
        id: 'rev_42',
        reviewerId: 'rev_42',
      });
      expect(store.get()?.reviewerId).toBe('rev_42');
    });
  });

  it('rejects a missing or wrong token', () => {
    expect(() => guard.canActivate(ctx({}).c)).toThrow(UnauthenticatedError);
    expect(() =>
      guard.canActivate(ctx({ 'x-internal-token': 'nope' }).c),
    ).toThrow(UnauthenticatedError);
    expect(() =>
      guard.canActivate(ctx({ 'x-internal-token': 'internal-token-longer' }).c),
    ).toThrow(UnauthenticatedError);
  });
});

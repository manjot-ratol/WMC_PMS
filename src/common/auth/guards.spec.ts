import type { ExecutionContext } from '@nestjs/common';
import { CorrelationStore } from '../correlation/correlation.store';
import { ForbiddenError, UnauthenticatedError } from '../errors/app-error';
import { ApplicationOwnershipGuard } from './application-ownership.guard';
import { bearerToken } from './bearer';
import { PreAuthGuard } from './preauth.guard';
import type { Principal } from './principal';
import { SessionGuard } from './session.guard';

type Req = {
  headers: Record<string, string>;
  params?: Record<string, string>;
  principal?: Principal;
  preauthToken?: string;
  sessionToken?: string;
};
const ctx = (req: Req) =>
  ({
    switchToHttp: () => ({ getRequest: () => req }),
  }) as unknown as ExecutionContext;
const TOKEN = 'a'.repeat(43);

describe('bearerToken', () => {
  it('parses Bearer tokens and rejects others', () => {
    expect(bearerToken(`Bearer ${TOKEN}`)).toBe(TOKEN);
    expect(bearerToken([`Bearer ${TOKEN}`])).toBe(TOKEN);
    expect(bearerToken('Basic abc')).toBeUndefined();
    expect(bearerToken('Bearer short')).toBeUndefined();
    expect(bearerToken(undefined)).toBeUndefined();
  });
});

describe('PreAuthGuard', () => {
  const store = new CorrelationStore();
  it('resolves the token into a PREAUTH principal bound to the phone fingerprint', async () => {
    const tokens = {
      resolve: jest.fn().mockResolvedValue({
        purpose: 'PMS_ONBOARDING',
        phoneFingerprint: 'fp1',
      }),
      issue: jest.fn(),
      revoke: jest.fn(),
    };
    const req: Req = { headers: { authorization: `Bearer ${TOKEN}` } };
    await expect(
      new PreAuthGuard(tokens, store).canActivate(ctx(req)),
    ).resolves.toBe(true);
    expect(req.principal).toEqual({ kind: 'PREAUTH', id: 'fp1' });
    expect(req.preauthToken).toBe(TOKEN);
  });
  it('rejects missing or unknown tokens', async () => {
    const tokens = {
      resolve: jest.fn().mockResolvedValue(null),
      issue: jest.fn(),
      revoke: jest.fn(),
    };
    await expect(
      new PreAuthGuard(tokens, store).canActivate(ctx({ headers: {} })),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(
      new PreAuthGuard(tokens, store).canActivate(
        ctx({ headers: { authorization: `Bearer ${TOKEN}` } }),
      ),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});

describe('SessionGuard', () => {
  const store = new CorrelationStore();
  it('resolves a CUSTOMER principal, records it in the correlation context and touches the session', async () => {
    const sessions = {
      resolve: jest.fn().mockResolvedValue({
        sessionId: 's',
        customerId: 'cus_1',
        applicationIds: ['app_1'],
      }),
      touch: jest.fn(),
      issue: jest.fn(),
      update: jest.fn(),
      revoke: jest.fn(),
    };
    const req: Req = { headers: { authorization: `Bearer ${TOKEN}` } };
    await store.run({ correlationId: 'c', requestId: 'r' }, async () => {
      await expect(
        new SessionGuard(sessions, store).canActivate(ctx(req)),
      ).resolves.toBe(true);
      expect(store.get()?.principalId).toBe('cus_1');
    });
    expect(req.principal).toEqual({
      kind: 'CUSTOMER',
      id: 'cus_1',
      applicationIds: ['app_1'],
    });
    expect(sessions.touch).toHaveBeenCalledWith(TOKEN);
  });
  it('rejects missing or expired sessions', async () => {
    const sessions = {
      resolve: jest.fn().mockResolvedValue(null),
      touch: jest.fn(),
      issue: jest.fn(),
      update: jest.fn(),
      revoke: jest.fn(),
    };
    await expect(
      new SessionGuard(sessions, store).canActivate(ctx({ headers: {} })),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(
      new SessionGuard(sessions, store).canActivate(
        ctx({ headers: { authorization: `Bearer ${TOKEN}` } }),
      ),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});

describe('ApplicationOwnershipGuard', () => {
  const guard = new ApplicationOwnershipGuard();
  const customer: Principal = {
    kind: 'CUSTOMER',
    id: 'cus_1',
    applicationIds: ['app_1'],
  };
  it('allows the owner and forbids others', () => {
    expect(
      guard.canActivate(
        ctx({
          headers: {},
          params: { application_id: 'app_1' },
          principal: customer,
        }),
      ),
    ).toBe(true);
    expect(() =>
      guard.canActivate(
        ctx({
          headers: {},
          params: { application_id: 'app_2' },
          principal: customer,
        }),
      ),
    ).toThrow(ForbiddenError);
    expect(() =>
      guard.canActivate(ctx({ headers: {}, params: {}, principal: customer })),
    ).toThrow(ForbiddenError);
  });
  it('requires a customer principal', () => {
    expect(() =>
      guard.canActivate(
        ctx({ headers: {}, params: { application_id: 'app_1' } }),
      ),
    ).toThrow(UnauthenticatedError);
    expect(() =>
      guard.canActivate(
        ctx({
          headers: {},
          params: { application_id: 'app_1' },
          principal: { kind: 'PREAUTH', id: 'fp' },
        }),
      ),
    ).toThrow(UnauthenticatedError);
  });
});

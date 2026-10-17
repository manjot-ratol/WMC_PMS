import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { IdempotencyMismatchError, ValidationError } from '../errors/app-error';
import {
  IDEMPOTENT_KEY,
  IdempotencyInterceptor,
} from './idempotency.interceptor';

function ctxFor(opts: {
  key?: string;
  body?: unknown;
  principalId?: string;
  idempotent?: boolean;
  status?: number;
}): ExecutionContext {
  const res = { statusCode: opts.status ?? 201, setHeader: jest.fn() };
  const req = {
    method: 'POST',
    route: { path: '/v1/x/:id' },
    body: opts.body ?? {},
    ip: '1.2.3.4',
    headers: opts.key !== undefined ? { 'idempotency-key': opts.key } : {},
    principal: opts.principalId
      ? { kind: 'CUSTOMER', id: opts.principalId }
      : undefined,
  };
  return {
    getType: () => 'http',
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    __res: res,
  } as unknown as ExecutionContext;
}

describe('IdempotencyInterceptor', () => {
  const records = new Map<string, unknown>();
  const port = {
    find: jest.fn((p: string, r: string, k: string) =>
      Promise.resolve((records.get(`${p}|${r}|${k}`) as never) ?? null),
    ),
    save: jest.fn(
      (rec: { principalId: string; route: string; key: string }) => {
        records.set(`${rec.principalId}|${rec.route}|${rec.key}`, rec);
        return Promise.resolve();
      },
    ),
  };
  const reflector = { getAllAndOverride: jest.fn() };
  const interceptor = new IdempotencyInterceptor(reflector as never, port, {
    now: () => new Date('2026-10-18T00:00:00Z'),
  });
  const next = (value: unknown): CallHandler => ({ handle: () => of(value) });

  beforeEach(() => {
    records.clear();
    jest.clearAllMocks();
    reflector.getAllAndOverride.mockReturnValue(true);
  });

  it('passes through handlers not marked @Idempotent', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    await expect(
      lastValueFrom(await interceptor.intercept(ctxFor({}), next('v'))),
    ).resolves.toBe('v');
    expect(port.find).not.toHaveBeenCalled();
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      IDEMPOTENT_KEY,
      expect.any(Array),
    );
  });

  it('rejects a missing or malformed Idempotency-Key with 422', async () => {
    await expect(
      interceptor.intercept(ctxFor({ principalId: 'p' }), next('v')),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      interceptor.intercept(
        ctxFor({ principalId: 'p', key: 'x'.repeat(129) }),
        next('v'),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('executes once, stores, and replays with the same key and body', async () => {
    const first = await lastValueFrom(
      await interceptor.intercept(
        ctxFor({ principalId: 'p', key: 'k1', body: { a: 1 } }),
        next({ id: 'new' }),
      ),
    );
    expect(first).toEqual({ id: 'new' });
    expect(port.save).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: 'p',
        route: 'POST /v1/x/:id',
        key: 'k1',
        statusCode: 201,
        expiresAt: new Date('2026-10-19T00:00:00Z'),
      }),
    );

    const ctx = ctxFor({ principalId: 'p', key: 'k1', body: { a: 1 } });
    const handler = { handle: jest.fn(() => of({ id: 'should-not-run' })) };
    const replay = await lastValueFrom(
      await interceptor.intercept(ctx, handler),
    );
    expect(replay).toEqual({ id: 'new' });
    expect(handler.handle).not.toHaveBeenCalled();
    const res = (
      ctx as unknown as { __res: { setHeader: jest.Mock; statusCode: number } }
    ).__res;
    expect(res.setHeader).toHaveBeenCalledWith('Idempotent-Replay', 'true');
    expect(res.statusCode).toBe(201);
  });

  it('rejects the same key with a different body', async () => {
    await lastValueFrom(
      await interceptor.intercept(
        ctxFor({ principalId: 'p', key: 'k2', body: { a: 1 } }),
        next({}),
      ),
    );
    await expect(
      interceptor.intercept(
        ctxFor({ principalId: 'p', key: 'k2', body: { a: 2 } }),
        next({}),
      ),
    ).rejects.toBeInstanceOf(IdempotencyMismatchError);
  });

  it('accepts a repeated header (first value), falls back to the url when no route, and stores null bodies', async () => {
    const ctx = ctxFor({ principalId: 'p', key: 'k9', body: undefined });
    const req = ctx.switchToHttp().getRequest<{
      headers: Record<string, unknown>;
      route?: unknown;
      originalUrl?: string;
    }>();
    req.headers['idempotency-key'] = ['k9', 'other'];
    delete req.route;
    req.originalUrl = '/v1/raw?x=1';
    await lastValueFrom(
      await interceptor.intercept(ctx, { handle: () => of(undefined) }),
    );
    expect(port.save).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'k9',
        route: 'POST /v1/raw',
        responseBody: null,
      }),
    );
  });

  it('scopes pre-auth requests by client ip', async () => {
    await lastValueFrom(
      await interceptor.intercept(ctxFor({ key: 'k3' }), next({})),
    );
    expect(port.save).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: expect.stringMatching(/^anon:/) as string,
      }),
    );
  });
});

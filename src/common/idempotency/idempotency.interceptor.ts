import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { Observable, of, tap } from 'rxjs';
import type { ClockPort } from '../../application/ports/clock.port';
import { CLOCK } from '../../application/ports/clock.port';
import type { IdempotencyPort } from '../../application/ports/idempotency.port';
import { IDEMPOTENCY } from '../../application/ports/idempotency.port';
import type { AuthenticatedRequest } from '../auth/principal';
import { IdempotencyMismatchError, ValidationError } from '../errors/app-error';
import { IDEMPOTENT_KEY } from './idempotency.decorator';

export { IDEMPOTENT_KEY };

export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const IDEMPOTENCY_TTL_HOURS = 24;
const KEY_RE = /^[\x21-\x7e]{1,128}$/;

type IdemRequest = AuthenticatedRequest & {
  method: string;
  ip?: string;
  body?: unknown;
  route?: { path?: string };
  originalUrl?: string;
  headers: Record<string, string | string[] | undefined>;
};

/**
 * Durable idempotency for mutating routes: same principal + route + key replays the stored response;
 * same key with a different body is rejected.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(IDEMPOTENCY) private readonly records: IdempotencyPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const marked = this.reflector.getAllAndOverride<boolean | undefined>(
      IDEMPOTENT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!marked) return next.handle();

    const req = context.switchToHttp().getRequest<IdemRequest>();
    const res = context.switchToHttp().getResponse<{
      statusCode: number;
      setHeader(n: string, v: string): void;
    }>();
    const raw = req.headers[IDEMPOTENCY_HEADER];
    const key = Array.isArray(raw) ? raw[0] : raw;
    if (!key || !KEY_RE.test(key))
      throw new ValidationError('Idempotency-Key header is required', {
        details: { header: 'Idempotency-Key' },
      });

    const principalId = req.principal
      ? req.principal.id
      : `anon:${hash(req.ip ?? 'unknown')}`;
    const route = `${req.method} ${req.route?.path ?? req.originalUrl?.split('?')[0] ?? ''}`;
    const requestHash = hash(JSON.stringify(req.body ?? null));

    const existing = await this.records.find(principalId, route, key);
    if (existing) {
      if (existing.requestHash !== requestHash)
        throw new IdempotencyMismatchError();
      res.statusCode = existing.statusCode;
      res.setHeader('Idempotent-Replay', 'true');
      return of(existing.responseBody);
    }

    return next.handle().pipe(
      tap((body: unknown) => {
        const expiresAt = new Date(
          this.clock.now().getTime() + IDEMPOTENCY_TTL_HOURS * 3600 * 1000,
        );
        void this.records.save({
          principalId,
          route,
          key,
          requestHash,
          statusCode: res.statusCode,
          responseBody: body ?? null,
          expiresAt,
        });
      }),
    );
  }
}

function hash(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

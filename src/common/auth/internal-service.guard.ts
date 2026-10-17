import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { appConfig } from '../config/app.config';
import { CorrelationStore } from '../correlation/correlation.store';
import { constantTimeEquals } from '../crypto/constant-time';
import { UnauthenticatedError } from '../errors/app-error';
import type { AuthenticatedRequest } from './principal';

export const INTERNAL_TOKEN_HEADER = 'x-internal-token';
export const REVIEWER_ID_HEADER = 'x-reviewer-id';

/** Service-to-service and reviewer access for /internal/v1. */
@Injectable()
export class InternalServiceGuard implements CanActivate {
  constructor(
    @Inject(appConfig.KEY)
    private readonly cfg: Pick<
      ReturnType<typeof appConfig>,
      'internalServiceToken'
    >,
    private readonly store: CorrelationStore,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<
      AuthenticatedRequest & {
        headers: Record<string, string | string[] | undefined>;
      }
    >();
    const token = headerValue(req.headers[INTERNAL_TOKEN_HEADER]);
    if (!token || !constantTimeEquals(token, this.cfg.internalServiceToken))
      throw new UnauthenticatedError();

    const reviewerId = headerValue(req.headers[REVIEWER_ID_HEADER]);
    if (reviewerId) {
      req.principal = { kind: 'REVIEWER', id: reviewerId, reviewerId };
      this.store.set({ reviewerId, principalId: reviewerId });
    } else {
      req.principal = { kind: 'INTERNAL', id: 'internal' };
      this.store.set({ principalId: 'internal' });
    }
    return true;
  }
}

function headerValue(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() !== '' ? s.trim() : undefined;
}

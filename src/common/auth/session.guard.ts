import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import {
  SESSION_STORE,
  type SessionStore,
} from '../../application/ports/token-store.port';
import { CorrelationStore } from '../correlation/correlation.store';
import { UnauthenticatedError } from '../errors/app-error';
import { bearerToken } from './bearer';
import type { AuthenticatedRequest } from './principal';

/** Customer session: resolves the bearer token to a CUSTOMER principal and slides the expiry. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
    private readonly store: CorrelationStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<
      AuthenticatedRequest & {
        headers: Record<string, string | string[] | undefined>;
        sessionToken?: string;
      }
    >();
    const token = bearerToken(req.headers.authorization);
    if (!token) throw new UnauthenticatedError();
    const data = await this.sessions.resolve(token);
    if (!data) throw new UnauthenticatedError();
    req.principal = {
      kind: 'CUSTOMER',
      id: data.customerId,
      applicationIds: data.applicationIds,
    };
    req.sessionToken = token;
    this.store.set({ principalId: data.customerId });
    await this.sessions.touch(token);
    return true;
  }
}

import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import {
  PREAUTH_TOKEN_STORE,
  type PreAuthTokenStore,
} from '../../application/ports/token-store.port';
import { CorrelationStore } from '../correlation/correlation.store';
import { UnauthenticatedError } from '../errors/app-error';
import { bearerToken } from './bearer';
import type { AuthenticatedRequest } from './principal';

/** Challenge-bound pre-auth credential: allows only verify/resend for the bound phone. */
@Injectable()
export class PreAuthGuard implements CanActivate {
  constructor(
    @Inject(PREAUTH_TOKEN_STORE) private readonly tokens: PreAuthTokenStore,
    private readonly store: CorrelationStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<
      AuthenticatedRequest & {
        headers: Record<string, string | string[] | undefined>;
        preauthToken?: string;
      }
    >();
    const token = bearerToken(req.headers.authorization);
    if (!token) throw new UnauthenticatedError();
    const binding = await this.tokens.resolve(token);
    if (!binding) throw new UnauthenticatedError();
    req.principal = { kind: 'PREAUTH', id: binding.phoneFingerprint };
    req.preauthToken = token;
    this.store.set({ principalId: 'preauth' });
    return true;
  }
}

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UnauthenticatedError } from '../errors/app-error';
import type { AuthenticatedRequest, Principal } from './principal';

/** Injects the authenticated principal; throws 401 if a guard did not set one. */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.principal) throw new UnauthenticatedError();
    return req.principal;
  },
);

import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ForbiddenError, UnauthenticatedError } from '../errors/app-error';
import type { AuthenticatedRequest } from './principal';

export const APPLICATION_ID_PARAM = 'application_id';

/** The application in the path must belong to the authenticated customer. Never trust ids in bodies. */
@Injectable()
export class ApplicationOwnershipGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest & { params: Record<string, string> }>();
    const principal = req.principal;
    if (!principal || principal.kind !== 'CUSTOMER')
      throw new UnauthenticatedError();
    const applicationId = req.params[APPLICATION_ID_PARAM];
    if (!applicationId || !principal.applicationIds?.includes(applicationId))
      throw new ForbiddenError();
    return true;
  }
}

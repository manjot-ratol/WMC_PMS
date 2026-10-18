import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { ApplicationOwnershipGuard } from './application-ownership.guard';
import { InternalServiceGuard } from './internal-service.guard';
import { PreAuthGuard } from './preauth.guard';
import { SessionGuard } from './session.guard';

export const BEARER_SCHEME = 'session';

/** Pre-auth bearer (phone challenge verify/resend). */
export const UsePreAuth = () =>
  applyDecorators(UseGuards(PreAuthGuard), ApiBearerAuth(BEARER_SCHEME));
/** Customer session bearer. */
export const UseSession = () =>
  applyDecorators(UseGuards(SessionGuard), ApiBearerAuth(BEARER_SCHEME));
/** Customer session bearer + ownership of the {application_id} path parameter. */
export const UseApplicationSession = () =>
  applyDecorators(
    UseGuards(SessionGuard, ApplicationOwnershipGuard),
    ApiBearerAuth(BEARER_SCHEME),
  );
/** Service / reviewer access for /internal routes. */
export const UseInternal = () =>
  applyDecorators(UseGuards(InternalServiceGuard));

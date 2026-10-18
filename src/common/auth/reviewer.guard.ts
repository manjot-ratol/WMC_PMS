import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { UnauthenticatedError } from '../errors/app-error';
import { InternalServiceGuard } from './internal-service.guard';

export const REVIEWER_HEADER = 'x-reviewer-id';
const REVIEWER_ID = /^[A-Za-z0-9._@-]{2,64}$/;

/** Service token plus a mandatory, well-formed reviewer id; the id is what the audit trail records. */
@Injectable()
export class ReviewerGuard implements CanActivate {
  constructor(private readonly internal: InternalServiceGuard) {}
  canActivate(ctx: ExecutionContext): boolean {
    this.internal.canActivate(ctx);
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { reviewerId?: string }>();
    const raw = req.headers[REVIEWER_HEADER];
    const id = Array.isArray(raw) ? raw[0] : raw;
    if (!id || !REVIEWER_ID.test(id))
      throw new UnauthenticatedError('X-Reviewer-Id header is required');
    req.reviewerId = id;
    return true;
  }
}

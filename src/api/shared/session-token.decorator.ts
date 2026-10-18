import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** The raw bearer token a guard validated (pre-auth or session), for revocation or rotation. */
export const BearerTokenValue = createParamDecorator(
  (_d: unknown, ctx: ExecutionContext): string => {
    const req = ctx
      .switchToHttp()
      .getRequest<{ preauthToken?: string; sessionToken?: string }>();
    return req.preauthToken ?? req.sessionToken ?? '';
  },
);

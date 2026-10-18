import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export function clientIpFromContext(ctx: ExecutionContext): string {
  const req = ctx
    .switchToHttp()
    .getRequest<{ ip?: string; socket?: { remoteAddress?: string } }>();
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}

/** Client IP as seen behind the trusted proxy (app.set('trust proxy', 1)). */
export const ClientIp = createParamDecorator(
  (_d: unknown, ctx: ExecutionContext) => clientIpFromContext(ctx),
);

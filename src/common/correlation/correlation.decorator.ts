import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { CORRELATION_HEADER } from './correlation.constants';

/** Injects the correlation id of the current request into a handler parameter. */
export const CorrelationId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const res = ctx
      .switchToHttp()
      .getResponse<{ getHeader(name: string): unknown }>();
    const value = res.getHeader(CORRELATION_HEADER);
    return typeof value === 'string' ? value : 'none';
  },
);

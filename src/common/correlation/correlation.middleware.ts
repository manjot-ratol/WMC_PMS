import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import {
  CORRELATION_HEADER,
  REQUEST_ID_HEADER,
  isValidCorrelationId,
} from './correlation.constants';
import { CorrelationStore } from './correlation.store';

/** First middleware in the chain: establishes the correlation id for the whole request lifetime. */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  constructor(private readonly store: CorrelationStore) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const incoming =
      req.headers[CORRELATION_HEADER.toLowerCase()] ??
      req.headers[REQUEST_ID_HEADER.toLowerCase()];
    const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
    const correlationId = isValidCorrelationId(candidate)
      ? candidate
      : randomUUID();
    res.setHeader(CORRELATION_HEADER, correlationId);
    this.store.run({ correlationId, requestId: randomUUID() }, () => next());
  }
}

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { AppLogger } from './logger.service';

/** One line per HTTP request: method, route template, status, duration. Never bodies or raw paths. */
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger: AppLogger;

  constructor(logger: AppLogger) {
    this.logger = logger.child('http');
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const started = Date.now();
    const route = routeTemplateOf(req) ?? req.originalUrl.split('?')[0];

    return next.handle().pipe(
      tap({
        next: () =>
          this.logger.info('http.request', {
            method: req.method,
            route,
            status: res.statusCode,
            durationMs: Date.now() - started,
            outcome: 'ok',
          }),
        error: (err: unknown) =>
          this.logger.warn('http.request', {
            method: req.method,
            route,
            status: res.statusCode,
            durationMs: Date.now() - started,
            outcome: 'error',
            errorName: err instanceof Error ? err.name : 'unknown',
          }),
      }),
    );
  }
}

function routeTemplateOf(req: Request): string | undefined {
  const route = (req as { route?: unknown }).route;
  if (route && typeof route === 'object' && 'path' in route) {
    const path = (route as { path?: unknown }).path;
    return typeof path === 'string' ? path : undefined;
  }
  return undefined;
}

import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { RequestLoggingInterceptor } from './request-logging.interceptor';

function ctx(
  method: string,
  routePath: string | undefined,
  url: string,
  status: number,
): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({
        method,
        originalUrl: url,
        route: routePath ? { path: routePath } : undefined,
      }),
      getResponse: () => ({ statusCode: status }),
    }),
  } as unknown as ExecutionContext;
}

describe('RequestLoggingInterceptor', () => {
  const logger = { info: jest.fn(), warn: jest.fn(), child: jest.fn() };
  logger.child.mockReturnValue(logger);
  const interceptor = new RequestLoggingInterceptor(logger as never);
  beforeEach(() => jest.clearAllMocks());

  it('logs method, route template, status and duration, never the raw url', (done) => {
    const next: CallHandler = { handle: () => of('ok') };
    interceptor
      .intercept(
        ctx(
          'POST',
          '/v1/onboarding/applications/:id/profile',
          '/v1/onboarding/applications/app_123/profile',
          200,
        ),
        next,
      )
      .subscribe(() => {
        const [msg, fields] = logger.info.mock.calls[0] as [
          string,
          Record<string, unknown>,
        ];
        expect(msg).toBe('http.request');
        expect(fields).toMatchObject({
          method: 'POST',
          route: '/v1/onboarding/applications/:id/profile',
          status: 200,
        });
        expect(typeof fields.durationMs).toBe('number');
        expect(JSON.stringify(fields)).not.toContain('app_123');
        done();
      });
  });

  it('falls back to the url path without query when no route matched and logs errors at warn', (done) => {
    const next: CallHandler = {
      handle: () => throwError(() => new Error('x')),
    };
    interceptor
      .intercept(ctx('GET', undefined, '/nope?x=1', 404), next)
      .subscribe({
        error: () => {
          const fields = logger.warn.mock.calls[0][1] as Record<
            string,
            unknown
          >;
          expect(fields.route).toBe('/nope');
          expect(fields.outcome).toBe('error');
          done();
        },
      });
  });

  it('passes through non-http contexts', (done) => {
    const c = { getType: () => 'rpc' } as unknown as ExecutionContext;
    interceptor.intercept(c, { handle: () => of(1) }).subscribe((v) => {
      expect(v).toBe(1);
      expect(logger.info).not.toHaveBeenCalled();
      done();
    });
  });
});

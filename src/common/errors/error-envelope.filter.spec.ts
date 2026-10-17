import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { CorrelationStore } from '../correlation/correlation.store';
import { InternalError, StaleVersionError } from './app-error';
import { ErrorEnvelope, ErrorEnvelopeFilter } from './error-envelope.filter';

function hostWith(res: { status: jest.Mock; json: jest.Mock }): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ method: 'GET', url: '/x' }),
    }),
  } as unknown as ArgumentsHost;
}

describe('ErrorEnvelopeFilter', () => {
  const store = new CorrelationStore();
  const logger = { error: jest.fn(), warn: jest.fn(), child: jest.fn() };
  const filter = new ErrorEnvelopeFilter(store, logger);
  let res: { status: jest.Mock; json: jest.Mock<void, [ErrorEnvelope]> };

  beforeEach(() => {
    res = { status: jest.fn(), json: jest.fn<void, [ErrorEnvelope]>() };
    res.status.mockReturnValue(res);
    logger.error.mockReset();
  });

  const inContext = <T>(fn: () => T) =>
    store.run({ correlationId: 'corr-1', requestId: 'req-1' }, fn);

  it('maps StaleVersionError to a 409 envelope with request_id', () => {
    inContext(() => filter.catch(new StaleVersionError(), hostWith(res)));
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'STALE_VERSION',
        message: 'Your application has changed. Review the latest details.',
        retryable: false,
      },
      request_id: 'corr-1',
    });
  });

  it('maps an unknown Error to 500 with a generic message and logs the stack', () => {
    inContext(() =>
      filter.catch(new Error('secret internal detail'), hostWith(res)),
    );
    expect(res.status).toHaveBeenCalledWith(500);
    const body: ErrorEnvelope = res.json.mock.calls[0][0];
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toContain('secret internal detail');
    expect(logger.error).toHaveBeenCalled();
  });

  it('maps class-validator BadRequestException to 422 ACTION_REQUIRED', () => {
    inContext(() =>
      filter.catch(new BadRequestException(['pan must match']), hostWith(res)),
    );
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json.mock.calls[0][0].error.code).toBe('ACTION_REQUIRED');
  });

  it('maps NotFoundException to 404 NOT_FOUND', () => {
    inContext(() => filter.catch(new NotFoundException(), hostWith(res)));
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].error.code).toBe('NOT_FOUND');
  });

  it('marks 429 and 503 HttpExceptions retryable and unknown 5xx as INTERNAL_ERROR', () => {
    inContext(() =>
      filter.catch(new HttpException('slow down', 429), hostWith(res)),
    );
    expect(res.json.mock.calls[0][0].error).toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
    });
    inContext(() =>
      filter.catch(new HttpException('gone', 503), hostWith(res)),
    );
    expect(res.json.mock.calls[1][0].error).toMatchObject({
      code: 'VERIFICATION_UNAVAILABLE',
      retryable: true,
    });
    inContext(() =>
      filter.catch(new HttpException('teapot', 418), hostWith(res)),
    );
    expect(res.json.mock.calls[2][0].error.code).toBe('ACTION_REQUIRED');
    inContext(() =>
      filter.catch(new HttpException('bad gateway', 502), hostWith(res)),
    );
    expect(res.json.mock.calls[3][0].error.code).toBe('INTERNAL_ERROR');
  });

  it('logs AppErrors with 5xx status', () => {
    inContext(() =>
      filter.catch(
        new InternalError('x', { details: { a: 1 } }),
        hostWith(res),
      ),
    );
    expect(logger.error).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('uses "none" as request_id outside a correlation context', () => {
    filter.catch(new StaleVersionError(), hostWith(res));
    expect(res.json.mock.calls[0][0].request_id).toBe('none');
  });
});

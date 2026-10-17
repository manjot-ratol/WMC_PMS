import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Response } from 'express';
import { CorrelationStore } from '../correlation/correlation.store';
import type { AppLogger } from '../logging/logger.service';
import { AppError } from './app-error';
import { ERROR_MESSAGES, ErrorCode } from './error-codes';

export interface ErrorEnvelope {
  error: { code: ErrorCode; message: string; retryable: boolean };
  request_id: string;
}

const HTTP_TO_CODE: Record<number, ErrorCode> = {
  400: 'ACTION_REQUIRED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'STALE_VERSION',
  422: 'ACTION_REQUIRED',
  429: 'RATE_LIMITED',
  503: 'VERIFICATION_UNAVAILABLE',
};

/** Global filter: every failure leaves the API as the spec's error envelope, never a stack or vendor detail. */
@Catch()
@Injectable()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  constructor(
    private readonly store: CorrelationStore,
    private readonly logger: Pick<AppLogger, 'error' | 'warn'>,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.toEnvelope(exception);
    res.status(status).json(body);
  }

  toEnvelope(exception: unknown): { status: number; body: ErrorEnvelope } {
    const requestId = this.store.getCorrelationId();

    if (exception instanceof AppError) {
      if (exception.httpStatus >= 500) {
        this.logger.error(exception.message, {
          code: exception.code,
          err: exception,
        });
      }
      return {
        status: exception.httpStatus,
        body: {
          error: {
            code: exception.code,
            message: exception.message,
            retryable: exception.retryable,
          },
          request_id: requestId,
        },
      };
    }

    if (exception instanceof HttpException) {
      const raw = exception.getStatus();
      const status = raw === 400 ? 422 : raw;
      const code =
        HTTP_TO_CODE[status] ??
        (status >= 500 ? 'INTERNAL_ERROR' : 'ACTION_REQUIRED');
      return {
        status,
        body: {
          error: {
            code,
            message: ERROR_MESSAGES[code],
            retryable:
              code === 'RATE_LIMITED' || code === 'VERIFICATION_UNAVAILABLE',
          },
          request_id: requestId,
        },
      };
    }

    this.logger.error('Unhandled exception', { err: exception });
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        error: {
          code: 'INTERNAL_ERROR',
          message: ERROR_MESSAGES.INTERNAL_ERROR,
          retryable: false,
        },
        request_id: requestId,
      },
    };
  }
}

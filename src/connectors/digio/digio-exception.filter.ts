import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { DigioApiError, DigioValidationError } from './digio.errors';

/**
 * Translates connector errors into HTTP responses:
 *  - DigioValidationError -> 400 (caller sent a bad request)
 *  - DigioApiError 4xx    -> 502 with Digio's status/code/details attached
 *  - DigioApiError 5xx / transport -> 502 / 504
 */
@Catch(DigioApiError, DigioValidationError)
export class DigioExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DigioExceptionFilter.name);

  catch(exception: DigioApiError | DigioValidationError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof DigioValidationError) {
      res.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        message: exception.message,
        field: exception.field,
      });
      return;
    }

    const status = exception.isTransportError
      ? HttpStatus.GATEWAY_TIMEOUT
      : HttpStatus.BAD_GATEWAY;
    this.logger.error(exception.message);
    res.status(status).json({
      statusCode: status,
      error: exception.isTransportError ? 'Gateway Timeout' : 'Bad Gateway',
      message: exception.message,
      digio: {
        httpStatus: exception.httpStatus,
        code: exception.code,
        details: exception.details,
        referenceId: exception.referenceId,
        path: exception.path,
        body: exception.body,
      },
    });
  }
}

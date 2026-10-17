import { ERROR_MESSAGES, ErrorCode } from './error-codes';

export interface AppErrorOptions {
  retryable?: boolean;
  cause?: unknown;
  /** Safe, structured detail for the envelope/logs (never raw partner payloads). */
  details?: Record<string, unknown>;
}

/** Base class for every error the application raises deliberately. */
export abstract class AppError extends Error {
  readonly details?: Record<string, unknown>;
  readonly retryable: boolean;
  override readonly cause?: unknown;

  protected constructor(
    readonly code: ErrorCode,
    readonly httpStatus: number,
    message?: string,
    opts: AppErrorOptions = {},
    defaultRetryable = false,
  ) {
    super(message ?? ERROR_MESSAGES[code]);
    this.name = new.target.name;
    this.retryable = opts.retryable ?? defaultRetryable;
    this.cause = opts.cause;
    this.details = opts.details;
  }
}

export class ValidationError extends AppError {
  constructor(message?: string, opts?: AppErrorOptions) {
    super('ACTION_REQUIRED', 422, message, opts);
  }
}
export class OtpInvalidError extends AppError {
  constructor(message?: string, opts?: AppErrorOptions) {
    super('OTP_INVALID_OR_EXPIRED', 422, message, opts);
  }
}
export class UnauthenticatedError extends AppError {
  constructor(message?: string, opts?: AppErrorOptions) {
    super('UNAUTHENTICATED', 401, message, opts);
  }
}
export class ForbiddenError extends AppError {
  constructor(message?: string, opts?: AppErrorOptions) {
    super('FORBIDDEN', 403, message, opts);
  }
}
export class NotFoundError extends AppError {
  constructor(message?: string, opts?: AppErrorOptions) {
    super('NOT_FOUND', 404, message, opts);
  }
}
export class StaleVersionError extends AppError {
  constructor(message?: string, opts?: AppErrorOptions) {
    super('STALE_VERSION', 409, message, opts);
  }
}
export class LockUnavailableError extends AppError {
  constructor(message?: string, opts?: AppErrorOptions) {
    super('LOCK_UNAVAILABLE', 409, message, opts, true);
  }
}
export class RateLimitedError extends AppError {
  constructor(
    readonly retryAfterSeconds = 0,
    message?: string,
    opts?: AppErrorOptions,
  ) {
    super('RATE_LIMITED', 429, message, opts, true);
  }
}
export class DependencyUnavailableError extends AppError {
  constructor(message?: string, opts?: AppErrorOptions) {
    super('VERIFICATION_UNAVAILABLE', 503, message, opts, true);
  }
}
export class IdempotencyMismatchError extends AppError {
  constructor(message?: string, opts?: AppErrorOptions) {
    super('IDEMPOTENCY_MISMATCH', 422, message, opts);
  }
}
/** A partner answered with a definitive rejection (4xx); not retryable without changing the request. */
export class PartnerRejectedError extends AppError {
  constructor(
    readonly partner: string,
    readonly vendorCode: string | undefined,
    message?: string,
    opts?: AppErrorOptions,
  ) {
    super('PARTNER_REJECTED', 502, message, opts);
  }
}
export class InternalError extends AppError {
  constructor(message?: string, opts?: AppErrorOptions) {
    super('INTERNAL_ERROR', 500, message, opts);
  }
}

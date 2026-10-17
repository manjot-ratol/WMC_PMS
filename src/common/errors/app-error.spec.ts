import {
  AppError,
  DependencyUnavailableError,
  ForbiddenError,
  IdempotencyMismatchError,
  InternalError,
  NotFoundError,
  PartnerRejectedError,
  RateLimitedError,
  StaleVersionError,
  UnauthenticatedError,
  ValidationError,
} from './app-error';
import { ERROR_MESSAGES } from './error-codes';

describe('AppError hierarchy', () => {
  it.each([
    [new ValidationError(), 422, 'ACTION_REQUIRED', false],
    [new UnauthenticatedError(), 401, 'UNAUTHENTICATED', false],
    [new ForbiddenError(), 403, 'FORBIDDEN', false],
    [new NotFoundError(), 404, 'NOT_FOUND', false],
    [new StaleVersionError(), 409, 'STALE_VERSION', false],
    [new RateLimitedError(), 429, 'RATE_LIMITED', true],
    [new DependencyUnavailableError(), 503, 'VERIFICATION_UNAVAILABLE', true],
    [new IdempotencyMismatchError(), 422, 'IDEMPOTENCY_MISMATCH', false],
    [new PartnerRejectedError('digio', 'X'), 502, 'PARTNER_REJECTED', false],
    [new InternalError(), 500, 'INTERNAL_ERROR', false],
  ])(
    '%s carries status, code and retryable',
    (err, status, code, retryable) => {
      expect(err).toBeInstanceOf(AppError);
      expect(err.httpStatus).toBe(status);
      expect(err.code).toBe(code);
      expect(err.retryable).toBe(retryable);
      expect(err.message).toBe(ERROR_MESSAGES[err.code]);
    },
  );

  it('allows a custom customer-safe message, details and cause', () => {
    const cause = new Error('db down');
    const err = new ValidationError('Date must be DD/MM/YYYY', {
      details: { field: 'dob' },
      cause,
    });
    expect(err.message).toBe('Date must be DD/MM/YYYY');
    expect(err.details).toEqual({ field: 'dob' });
    expect(err.cause).toBe(cause);
    expect(err.name).toBe('ValidationError');
  });

  it('exposes a customer-safe message for every code', () => {
    for (const msg of Object.values(ERROR_MESSAGES)) {
      expect(msg.length).toBeGreaterThan(5);
      expect(msg).not.toMatch(/digio|trackwizz|prisma|redis/i);
    }
  });
});

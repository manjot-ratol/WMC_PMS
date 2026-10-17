/** Customer-facing error codes and their default, customer-safe messages (spec wording where given). */
export const ERROR_MESSAGES = {
  ACTION_REQUIRED: 'Complete the required information to continue.',
  OTP_INVALID_OR_EXPIRED:
    'The code is invalid or expired. Request a new code if needed.',
  UNAUTHENTICATED: 'Sign in to continue.',
  FORBIDDEN: 'You do not have access to this resource.',
  NOT_FOUND: 'The requested resource was not found.',
  STALE_VERSION: 'Your application has changed. Review the latest details.',
  RATE_LIMITED: 'Please try again after the cooldown.',
  VERIFICATION_UNAVAILABLE:
    'Verification is temporarily unavailable. Your progress is saved.',
  IDEMPOTENCY_MISMATCH: 'This request was already made with different details.',
  LOCK_UNAVAILABLE: 'This action is already in progress. Please wait a moment.',
  PARTNER_REJECTED:
    'We could not complete this step. Please check the details and try again.',
  INTERNAL_ERROR: 'Something went wrong on our side. Please try again later.',
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

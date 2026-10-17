export const CORRELATION_HEADER = 'X-Correlation-ID';
export const REQUEST_ID_HEADER = 'X-Request-ID';

const VALID_ID = /^[\x21-\x7e]{1,128}$/; // printable ASCII, no spaces/control bytes, 1-128 chars

export function isValidCorrelationId(value: unknown): value is string {
  return typeof value === 'string' && VALID_ID.test(value);
}

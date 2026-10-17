/**
 * Shape of a Digio 4xx/5xx body (GenericBadRequestResponse in Digio's OpenAPI spec).
 */
export interface DigioErrorBody {
  details?: string;
  code?: string;
  message?: string;
  errors?: unknown;
}

/**
 * Thrown when Digio responds with a non-2xx status, or the request fails at the
 * transport level (timeout, DNS, connection reset).
 */
export class DigioApiError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number | undefined,
    readonly code: string | undefined,
    readonly details: string | undefined,
    readonly body: unknown,
    readonly referenceId: string | undefined,
    readonly path: string,
  ) {
    super(message);
    this.name = 'DigioApiError';
  }

  get isTransportError(): boolean {
    return this.httpStatus === undefined;
  }
}

/**
 * Thrown before any network call when the caller supplied a request that
 * Digio/KRA would certainly reject (missing PAN, malformed date, ...).
 */
export class DigioValidationError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = 'DigioValidationError';
  }
}

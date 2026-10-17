import { PartnerHttpError } from './partner-http.error';

export interface RetryPolicy {
  /** Total attempts including the first. 1 = no retry. */
  attempts: number;
  /** Base delay; doubles each retry. */
  backoffMs: number;
  retryOn?: (err: PartnerHttpError) => boolean;
}

export const defaultRetryOn = (err: PartnerHttpError): boolean =>
  err.isTransport || (err.status !== undefined && err.status >= 500);

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy,
  sleep: (ms: number) => Promise<void> = realSleep,
): Promise<T> {
  const shouldRetry = policy.retryOn ?? defaultRetryOn;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= Math.max(1, policy.attempts); attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = err instanceof PartnerHttpError && shouldRetry(err);
      if (!retryable || attempt === policy.attempts) throw err;
      await sleep(policy.backoffMs * 2 ** (attempt - 1));
    }
  }
  throw lastErr;
}

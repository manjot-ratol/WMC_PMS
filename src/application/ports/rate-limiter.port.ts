export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimiterPort {
  /** Fixed window counter; fails closed (throws DependencyUnavailableError) when the store is unreachable. */
  consume(
    scope: string,
    fingerprint: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitDecision>;
}
export const RATE_LIMITER = Symbol('RATE_LIMITER');

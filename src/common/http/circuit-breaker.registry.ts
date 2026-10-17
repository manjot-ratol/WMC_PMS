import { Inject, Injectable, Optional } from '@nestjs/common';
import CircuitBreaker from 'opossum';
import type { Partner } from './http-request.types';

export interface BreakerOptions {
  errorThresholdPercentage: number;
  resetTimeoutMs: number;
  volumeThreshold: number;
  rollingWindowMs: number;
}

export const BREAKER_OPTIONS = Symbol('BREAKER_OPTIONS');
export const DEFAULT_BREAKER_OPTIONS: BreakerOptions = {
  errorThresholdPercentage: 50,
  resetTimeoutMs: 30_000,
  volumeThreshold: 5,
  rollingWindowMs: 10_000,
};

type Action = (run: () => Promise<unknown>) => Promise<unknown>;

/** One opossum breaker per partner. The breaker wraps a thunk so one registry serves every operation. */
@Injectable()
export class CircuitBreakerRegistry {
  private readonly breakers = new Map<
    Partner,
    CircuitBreaker<[() => Promise<unknown>], unknown>
  >();
  private readonly options: BreakerOptions;

  constructor(@Optional() @Inject(BREAKER_OPTIONS) options?: BreakerOptions) {
    this.options = options ?? DEFAULT_BREAKER_OPTIONS;
  }

  get(partner: Partner): CircuitBreaker<[() => Promise<unknown>], unknown> {
    let b = this.breakers.get(partner);
    if (!b) {
      const action: Action = (run) => run();
      b = new CircuitBreaker(action, {
        name: partner,
        errorThresholdPercentage: this.options.errorThresholdPercentage,
        resetTimeout: this.options.resetTimeoutMs,
        volumeThreshold: this.options.volumeThreshold,
        rollingCountTimeout: this.options.rollingWindowMs,
        timeout: false,
        // 4xx are the partner's verdict on our request, not a health signal.
        errorFilter: (err: unknown) => isClientError(err),
      });
      this.breakers.set(partner, b);
    }
    return b;
  }
}

function isClientError(err: unknown): boolean {
  const status = (err as { status?: number } | undefined)?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

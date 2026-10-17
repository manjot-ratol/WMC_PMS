import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface CorrelationContext {
  correlationId: string;
  requestId: string;
  principalId?: string;
  reviewerId?: string;
}

export const NO_CORRELATION = 'none';

/** Request-scoped context carried through async calls, jobs and outbound requests. */
@Injectable()
export class CorrelationStore {
  private readonly als = new AsyncLocalStorage<CorrelationContext>();

  run<T>(ctx: CorrelationContext, fn: () => T): T {
    return this.als.run({ ...ctx }, fn);
  }

  get(): CorrelationContext | undefined {
    return this.als.getStore();
  }

  getCorrelationId(): string {
    return this.als.getStore()?.correlationId ?? NO_CORRELATION;
  }

  /** Patch the active context (e.g. once the principal is known). No-op outside a context. */
  set(patch: Partial<CorrelationContext>): void {
    const ctx = this.als.getStore();
    if (ctx) Object.assign(ctx, patch);
  }
}

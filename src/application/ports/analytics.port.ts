import type { TransactionContext } from './unit-of-work.port';

/** The only properties allowed on an analytics event. Anything else is a bug (and a privacy incident). */
export interface AnalyticsEvent {
  name: string;
  /** Opaque customer identity; omit before verification. */
  identity?: string;
  applicationId?: string;
  screenId: string;
  outcome?: string;
  safeErrorCategory?: string;
  attemptNumber?: number;
}

export interface AnalyticsPort {
  track(event: AnalyticsEvent, tx?: TransactionContext): Promise<void>;
}
export const ANALYTICS = Symbol('ANALYTICS');

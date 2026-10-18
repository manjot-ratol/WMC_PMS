export interface AnalyticsOutboxRow {
  id: string;
  eventName: string;
  identity?: string;
  properties: Record<string, unknown>;
  createdAt: Date;
  attempts: number;
}
/** Dispatcher side of the analytics outbox (the write side is AnalyticsPort). */
export interface AnalyticsOutboxPort {
  claimUndispatched(limit: number): Promise<AnalyticsOutboxRow[]>;
  markDispatched(ids: string[]): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  markDead(id: string, reason: string): Promise<void>;
}
export const ANALYTICS_OUTBOX = Symbol('ANALYTICS_OUTBOX');

export interface AnalyticsUploadEvent {
  identity?: string;
  objectId?: string;
  evtName: string;
  ts: number;
  evtData: Record<string, unknown>;
}
export interface AnalyticsUploadResult {
  /** Row ids accepted by the sink. */
  accepted: string[];
  /** Row ids the sink rejected, with the vendor message (never retried). */
  rejected: { id: string; error: string }[];
}
/** Where allowlisted events go: CleverTap in production, a log line locally. */
export interface AnalyticsSinkPort {
  upload(
    events: { id: string; event: AnalyticsUploadEvent }[],
  ): Promise<AnalyticsUploadResult>;
}
export const ANALYTICS_SINK = Symbol('ANALYTICS_SINK');

/** The only properties an analytics event may carry (design §4.9). Enforced at write and again at dispatch. */
export const ANALYTICS_PROPERTY_ALLOWLIST = [
  'event_id',
  'application_id',
  'screen_id',
  'step_id',
  'journey_version',
  'event_schema_version',
  'event_source',
  'attempt_number',
  'outcome',
  'safe_error_category',
] as const;

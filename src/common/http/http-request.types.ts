import type { RetryPolicy } from './retry.policy';

export type Partner =
  'digio' | 'trackwizz' | 'mfcentral' | 'ignosis' | 'clevertap' | 'messaging';

export type HttpAuth =
  | { type: 'basic'; username: string; password: string }
  | { type: 'bearer'; token: string }
  | { type: 'none' };

export interface HttpRequestSpec<TBody = unknown> {
  partner: Partner;
  /** Stable name for logs/metrics, e.g. 'kra.fetchDetails'. */
  operation: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: TBody;
  bodyType?: 'json' | 'form' | 'multipart' | 'text';
  responseType?: 'json' | 'text' | 'arraybuffer';
  auth?: HttpAuth;
  timeoutMs?: number;
  retry?: RetryPolicy;
  /** When set, this header is sent with the correlation id (e.g. Digio's X_REFERENCE_ID). */
  vendorReferenceHeader?: string;
}

export interface HttpResult<T> {
  status: number;
  headers: Record<string, string>;
  data: T;
  durationMs: number;
}

export type PartnerTimeouts = Record<Partner, number>;
export const PARTNER_TIMEOUTS = Symbol('PARTNER_TIMEOUTS');

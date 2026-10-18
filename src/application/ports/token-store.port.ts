import { createHash } from 'node:crypto';

export interface PreAuthBinding {
  purpose: 'PMS_ONBOARDING';
  phoneFingerprint: string;
}

/** Short-lived token that only allows verify/resend on challenges for the same phone. */
export interface PreAuthTokenStore {
  issue(binding: PreAuthBinding): Promise<string>;
  resolve(token: string): Promise<PreAuthBinding | null>;
  revoke(token: string): Promise<void>;
}
export const PREAUTH_TOKEN_STORE = Symbol('PREAUTH_TOKEN_STORE');

export interface SessionData {
  sessionId: string;
  customerId: string;
  applicationIds: string[];
}

export interface SessionStore {
  issue(data: SessionData): Promise<string>;
  resolve(token: string): Promise<SessionData | null>;
  /** Extends the sliding expiry. */
  touch(token: string): Promise<void>;
  /** Replaces the stored data (e.g. a newly created application id) keeping the same token. */
  update(token: string, data: SessionData): Promise<void>;
  revoke(token: string): Promise<void>;
}
export const SESSION_STORE = Symbol('SESSION_STORE');

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

import type { Screen } from '../onboarding/screens';

/** Screen 06A: a consent-driven CAS (consolidated account statement) pull from MF Central. */
export type PortfolioImportStatus =
  | 'AWAITING_AUTHORISATION'
  | 'IMPORTED'
  | 'FAILED'
  | 'DECLINED'
  | 'EXPIRED'
  | 'SKIPPED';

export type PortfolioFailureCategory =
  | 'provider_rejected'
  | 'provider_unavailable'
  | 'authorisation_declined'
  | 'invalid_payload'
  | 'expired';

export interface PortfolioImport {
  readonly id: string;
  readonly applicationId: string;
  readonly provider: 'MFCENTRAL';
  readonly status: PortfolioImportStatus;
  /** Our reference sent to the provider (`clientRefNo`); the callback is matched on it. */
  readonly clientRefNo: string;
  readonly providerRequestId?: string;
  readonly authorisationUrl?: string;
  readonly failureCategory?: PortfolioFailureCategory;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt?: Date;
}

export const TERMINAL_IMPORT_STATUSES: readonly PortfolioImportStatus[] = [
  'IMPORTED',
  'FAILED',
  'DECLINED',
  'EXPIRED',
  'SKIPPED',
];

/** An open import past its expiry reads as EXPIRED without a write. */
export function effectiveStatus(
  imp: Pick<PortfolioImport, 'status' | 'expiresAt'>,
  now: Date,
): PortfolioImportStatus {
  if (imp.status === 'AWAITING_AUTHORISATION' && imp.expiresAt <= now)
    return 'EXPIRED';
  return imp.status;
}

export function isOpen(
  imp: Pick<PortfolioImport, 'status' | 'expiresAt'>,
  now: Date,
): boolean {
  return effectiveStatus(imp, now) === 'AWAITING_AUTHORISATION';
}

/**
 * Where the customer goes next. IMPORTED shows the dashboard; a skipped import (step complete) continues the
 * journey; anything else keeps the customer on the import screen so they can retry or skip.
 */
export function importNextScreen(
  status: PortfolioImportStatus | undefined,
  stepComplete: boolean,
  afterImport: Screen,
): Screen {
  if (status === 'IMPORTED') return 'ASSETS_DASHBOARD';
  if (stepComplete) return afterImport;
  return 'PORTFOLIO_IMPORT';
}

const SUCCESS = /^(success|succeeded|approved|completed|ok|s|y|yes|true|1)$/i;

export type CallbackEvaluation =
  | { outcome: 'AUTHORISED'; cipher: string }
  | { outcome: 'DECLINED'; category: 'authorisation_declined' }
  | { outcome: 'INVALID'; category: 'invalid_payload' };

/**
 * Interprets what MF Central brings back to `redirectUrl`. The exact field names are not documented in the
 * collection (PLACEHOLDER_PENDING_MFCENTRAL_CONFIRMATION): `status` is read case-insensitively and the
 * encrypted statement is accepted under `response`, `data` or `casData`. A missing statement is never success.
 */
export function evaluateCallback(
  payload: Record<string, unknown>,
): CallbackEvaluation {
  const status = str(payload.status) ?? str(payload.result);
  const cipher =
    str(payload.response) ?? str(payload.data) ?? str(payload.casData);
  if (status !== undefined && !SUCCESS.test(status.trim()))
    return { outcome: 'DECLINED', category: 'authorisation_declined' };
  if (!cipher) return { outcome: 'INVALID', category: 'invalid_payload' };
  return { outcome: 'AUTHORISED', cipher };
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v : undefined;

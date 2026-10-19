import type { Screen } from '../onboarding/screens';

/**
 * Screen 06A: a consent-driven CAS (consolidated account statement) pull from MF Central.
 * AWAITING_AUTHORISATION = investor is on MF Central's page (OTP, data choice, QR download);
 * AWAITING_QR = MF Central sent the browser back, we are waiting for the QR image upload;
 * IMPORTED = `validateQRCode` returned the statement.
 */
export type PortfolioImportStatus =
  | 'AWAITING_AUTHORISATION'
  | 'AWAITING_QR'
  | 'IMPORTED'
  | 'FAILED'
  | 'DECLINED'
  | 'EXPIRED'
  | 'SKIPPED';

export type PortfolioFailureCategory =
  | 'provider_rejected'
  | 'provider_unavailable'
  | 'authorisation_declined'
  | 'qr_invalid'
  | 'invalid_payload'
  | 'expired';

export interface PortfolioImport {
  readonly id: string;
  readonly applicationId: string;
  readonly provider: 'MFCENTRAL';
  readonly status: PortfolioImportStatus;
  /** Our reference sent to the provider (`clientRefNo`). */
  readonly clientRefNo: string;
  /** MF Central's `reqId`; the return leg and `validateQRCode` are keyed on it. */
  readonly providerRequestId?: string;
  readonly authorisationUrl?: string;
  readonly failureCategory?: PortfolioFailureCategory;
  /** Last vendor message for a retryable QR failure (customer-safe, e.g. "Failed to Validate QR code"). */
  readonly lastError?: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt?: Date;
}

export const OPEN_IMPORT_STATUSES: readonly PortfolioImportStatus[] = [
  'AWAITING_AUTHORISATION',
  'AWAITING_QR',
];
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
  if (OPEN_IMPORT_STATUSES.includes(imp.status) && imp.expiresAt <= now)
    return 'EXPIRED';
  return imp.status;
}

export function isOpen(
  imp: Pick<PortfolioImport, 'status' | 'expiresAt'>,
  now: Date,
): boolean {
  return OPEN_IMPORT_STATUSES.includes(effectiveStatus(imp, now));
}

/**
 * Where the customer goes next. IMPORTED shows the dashboard; a skipped or declined import (step complete)
 * continues the journey; anything else keeps the customer on the import screen to retry, upload or skip.
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

export type ReturnEvaluation =
  | { outcome: 'SUCCESS'; reqId: string; type?: string }
  | { outcome: 'ERROR'; reqId?: string; code?: string; message?: string }
  | { outcome: 'INVALID' };

/**
 * What MF Central's consent app sends to `redirectUrl` (read from its bundle, 2026-10-19):
 * success → `?status=success&reqId=…&type=Summary|Detailed`; error → `?status=error&code=ERR_…&message=…`.
 */
export function evaluateReturn(
  params: Record<string, unknown>,
): ReturnEvaluation {
  const status = str(params.status)?.toLowerCase();
  const reqId = str(params.reqId) ?? str(params.reqid);
  if (status === 'success' && reqId)
    return { outcome: 'SUCCESS', reqId, type: str(params.type) };
  if (status === 'error' || status === 'failed' || status === 'failure')
    return {
      outcome: 'ERROR',
      reqId,
      code: str(params.code),
      message: str(params.message),
    };
  return { outcome: 'INVALID' };
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;

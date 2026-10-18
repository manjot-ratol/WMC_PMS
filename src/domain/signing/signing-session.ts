import type { Screen } from '../onboarding/screens';

export type SigningSessionStatus =
  | 'REQUESTED'
  | 'IN_PROGRESS'
  | 'EXECUTED'
  | 'EXPIRED'
  | 'FAILED'
  | 'CANCELLED'
  | 'SUPERSEDED';
export type SigningMethod = 'AADHAAR_ESIGN';

export interface SigningDocument {
  documentType: string;
  documentVersion: string;
  objectKey: string;
  sha256: string;
}
export interface SigningSession {
  readonly id: string;
  readonly applicationId: string;
  readonly snapshotId: string;
  readonly documentPackVersion: number;
  readonly signingMethod: SigningMethod;
  readonly status: SigningSessionStatus;
  readonly providerRequestId?: string;
  readonly packObjectKey: string;
  readonly packSha256: string;
  readonly documents: SigningDocument[];
  readonly pollCount: number;
  readonly lastProviderStatus?: string;
  readonly safeErrorCategory?: string;
  /** Object key of the signed pack downloaded from the provider. */
  readonly evidenceKey?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly executedAt?: Date;
}

export const OPEN_SIGNING_STATUSES: SigningSessionStatus[] = [
  'REQUESTED',
  'IN_PROGRESS',
];
export const TERMINAL_SIGNING_STATUSES: SigningSessionStatus[] = [
  'EXECUTED',
  'EXPIRED',
  'FAILED',
  'CANCELLED',
  'SUPERSEDED',
];

export interface ProviderSignView {
  agreementStatus?: string;
  signers: { identifier?: string; status?: string }[];
}
export type SignEvaluation =
  | { outcome: 'EXECUTED' }
  | { outcome: 'PENDING'; status: 'REQUESTED' | 'IN_PROGRESS' }
  | {
      outcome: 'TERMINAL';
      status: 'EXPIRED' | 'FAILED' | 'CANCELLED';
      category: string;
    };

/**
 * Only `completed` with every signing party `signed` is execution. `requested`/`draft` is never completion, even when
 * a party already shows `signed`. Expiry, failure and cancellation are terminal and need a new request.
 */
export function evaluateSignStatus(view: ProviderSignView): SignEvaluation {
  const agreement = (view.agreementStatus ?? '').toLowerCase();
  const statuses = view.signers.map((s) => (s.status ?? '').toLowerCase());
  if (
    agreement === 'completed' &&
    statuses.length > 0 &&
    statuses.every((s) => s === 'signed')
  )
    return { outcome: 'EXECUTED' };
  if (agreement === 'expired' || statuses.includes('expired'))
    return {
      outcome: 'TERMINAL',
      status: 'EXPIRED',
      category: 'sign_request_expired',
    };
  if (agreement === 'failed' || statuses.includes('failed'))
    return { outcome: 'TERMINAL', status: 'FAILED', category: 'sign_failed' };
  if (statuses.includes('cancelled') || statuses.includes('removed'))
    return {
      outcome: 'TERMINAL',
      status: 'CANCELLED',
      category: 'sign_request_cancelled',
    };
  return {
    outcome: 'PENDING',
    status: statuses.includes('signed') ? 'IN_PROGRESS' : 'REQUESTED',
  };
}

export function signingNextScreen(status: SigningSessionStatus): Screen {
  return status === 'EXECUTED' ? 'APPLICATION_PROCESSING' : 'SIGN_DOCUMENTS';
}

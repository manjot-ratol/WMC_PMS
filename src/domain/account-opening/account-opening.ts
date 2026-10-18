import { loadRulebook } from '../shared/rulebook-loader';

export interface AccountOpeningRulebook {
  version: string;
  kraFilingDays: number;
  ckycEnabled: boolean;
  kraServiceProvider: 'NDML' | 'CDSL' | 'CAMS';
  requiredAccountTypes: string[];
}
export const ACCOUNT_OPENING_RULEBOOK = Symbol('ACCOUNT_OPENING_RULEBOOK');
export const loadAccountOpeningRulebook = (
  file?: string,
): AccountOpeningRulebook =>
  loadRulebook<AccountOpeningRulebook>(
    'account-opening.v1.json',
    ['version', 'kraFilingDays', 'ckycEnabled', 'requiredAccountTypes'],
    file,
  );

export type Registry = 'KRA' | 'CKYC';
export type RegistrySubmissionStatus =
  | 'NOT_REQUIRED'
  | 'DEFERRED'
  | 'SUBMITTED'
  | 'ON_HOLD'
  | 'VERIFIED'
  | 'VALIDATED'
  | 'REJECTED'
  | 'ERROR';
export interface RegistrySubmission {
  readonly id: string;
  readonly applicationId: string;
  readonly runId: string;
  readonly registry: Registry;
  readonly status: RegistrySubmissionStatus;
  readonly basis?: string;
  readonly providerRequestId?: string;
  readonly clientReferenceId?: string;
  readonly lastProviderStatus?: string;
  readonly deadlineAt?: Date;
  readonly evidenceKey?: string;
  readonly safeErrorCategory?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
export type AccountOpeningRunStatus =
  'QUEUED' | 'RUNNING' | 'SUBMITTED' | 'ACCOUNTS_READY' | 'BLOCKED' | 'ERROR';
export interface AccountOpeningRun {
  readonly id: string;
  readonly applicationId: string;
  readonly snapshotId: string;
  readonly documentPackVersion: number;
  readonly status: AccountOpeningRunStatus;
  readonly blockers: string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt?: Date;
}
export type UnderlyingAccountStatus = 'PENDING' | 'READY' | 'REJECTED';
export interface UnderlyingAccount {
  readonly id: string;
  readonly applicationId: string;
  readonly providerReceiptKey: string;
  readonly provider: string;
  readonly accountType: string;
  readonly accountReference: string;
  readonly status: UnderlyingAccountStatus;
  readonly receivedAt: Date;
}

/** KRA webhook/registration statuses mapped to our registry states. Unknown values are ERROR, never success. */
export function mapKraStatus(
  raw: string | undefined,
): RegistrySubmissionStatus {
  switch ((raw ?? '').toUpperCase()) {
    case 'SUBMITTED':
    case 'NOT_CHECKED_WITH_RESPECTIVE_KRA':
    case 'KRA_NOT_REACHABLE':
    case 'EXISTING_KYC_SUBMITTED':
      return 'SUBMITTED';
    case 'KRA_VERIFIED':
      return 'VERIFIED';
    case 'KRA_VALIDATED':
      return 'VALIDATED';
    case 'ON_HOLD':
      return 'ON_HOLD';
    case 'REJECTED':
    case 'DEACTIVATED':
    case 'NOT_AVAILABLE':
      return 'REJECTED';
    default:
      return 'ERROR';
  }
}
const RANK: Record<RegistrySubmissionStatus, number> = {
  NOT_REQUIRED: 0,
  DEFERRED: 0,
  ERROR: 0,
  SUBMITTED: 1,
  ON_HOLD: 2,
  REJECTED: 3,
  VERIFIED: 4,
  VALIDATED: 5,
};
/** Monotonic: a callback may not move a submission backwards (e.g. VALIDATED → SUBMITTED). */
export function isRegistryRegression(
  current: RegistrySubmissionStatus,
  next: RegistrySubmissionStatus,
): boolean {
  return RANK[next] < RANK[current];
}
export const kraRegistrationRequired = (
  kycRoute: string | undefined,
): boolean => kycRoute === 'FRESH' || kycRoute === 'REMEDIATE';

export function accountsReady(
  accounts: Pick<UnderlyingAccount, 'accountType' | 'status'>[],
  rulebook: AccountOpeningRulebook,
): boolean {
  return rulebook.requiredAccountTypes.every((t) =>
    accounts.some((a) => a.accountType === t && a.status === 'READY'),
  );
}

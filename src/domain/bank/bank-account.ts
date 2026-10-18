import { ValidationError } from '../../common/errors/app-error';
import { loadRulebook } from '../shared/rulebook-loader';

export interface BankRulebook {
  version: string;
  validationMode: 'AUTO' | 'PENNY_DROP' | 'PENNY_LESS';
  verifiedMinScore: number;
  reviewMinScore: number;
  maxAttempts: number;
}
export const BANK_RULEBOOK = Symbol('BANK_RULEBOOK');
export const loadBankRulebook = (file?: string): BankRulebook =>
  loadRulebook<BankRulebook>(
    'bank.v1.json',
    ['version', 'validationMode', 'verifiedMinScore', 'reviewMinScore'],
    file,
  );

export type BankVerificationStatus =
  | 'PROCESSING'
  | 'VERIFIED'
  | 'ACTION_REQUIRED'
  | 'REVIEW_REQUIRED'
  | 'TECHNICAL_ERROR';
export type RequiredAction = 'CORRECT_DETAILS' | 'UPLOAD_BANK_PROOF';

export interface BankAccount {
  readonly id: string;
  readonly applicationId: string;
  readonly accountNumber: string;
  readonly ifsc: string;
  readonly holderName: string;
  readonly version: number;
  readonly createdAt: Date;
}

export interface BankVerification {
  readonly id: string;
  readonly applicationId: string;
  readonly bankAccountId: string;
  readonly status: BankVerificationStatus;
  readonly requiredActions: RequiredAction[];
  readonly providerReference?: string;
  readonly evidenceKey?: string;
  readonly safeErrorCategory?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_RE = /^\d{6,18}$/;

export function normaliseAccountNumber(raw: unknown): string {
  const v = typeof raw === 'string' ? raw.replace(/[\s-]/g, '') : '';
  if (!ACCOUNT_RE.test(v))
    throw new ValidationError('Enter a valid account number', {
      details: { field: 'account_number' },
    });
  return v;
}
export function normaliseIfsc(raw: unknown): string {
  const v =
    typeof raw === 'string' ? raw.replace(/\s+/g, '').toUpperCase() : '';
  if (!IFSC_RE.test(v))
    throw new ValidationError('Enter a valid IFSC', {
      details: { field: 'ifsc' },
    });
  return v;
}
export function maskAccount(accountNumber: string): string {
  return `••••${accountNumber.slice(-4)}`;
}

export interface ProviderBankOutcome {
  verified: boolean;
  fuzzyMatchScore?: number;
  errorCode?: string;
}
export type BankEvaluation =
  | { status: 'VERIFIED' }
  | { status: 'REVIEW_REQUIRED'; category: string }
  | {
      status: 'ACTION_REQUIRED';
      category: string;
      requiredActions: RequiredAction[];
    };

/** Ownership decision per the bank rulebook. A provider "verified" alone is not enough: the name must match. */
export function evaluateBankOutcome(
  o: ProviderBankOutcome,
  rulebook: BankRulebook,
): BankEvaluation {
  if (!o.verified)
    return {
      status: 'ACTION_REQUIRED',
      category: 'account_not_verified',
      requiredActions: ['CORRECT_DETAILS'],
    };
  const score = o.fuzzyMatchScore;
  if (score === undefined)
    return { status: 'REVIEW_REQUIRED', category: 'name_match_unavailable' };
  if (score >= rulebook.verifiedMinScore) return { status: 'VERIFIED' };
  if (score >= rulebook.reviewMinScore)
    return { status: 'REVIEW_REQUIRED', category: 'name_match_low' };
  return {
    status: 'ACTION_REQUIRED',
    category: 'name_mismatch',
    requiredActions: ['CORRECT_DETAILS', 'UPLOAD_BANK_PROOF'],
  };
}

export function bankNextScreen(
  status: BankVerificationStatus,
): 'BANK_PROGRESS' | 'NOMINATION' | 'BANK_DETAILS' | 'ASSISTED_ONBOARDING' {
  switch (status) {
    case 'VERIFIED':
      return 'NOMINATION';
    case 'ACTION_REQUIRED':
      return 'BANK_DETAILS';
    case 'REVIEW_REQUIRED':
      return 'ASSISTED_ONBOARDING';
    default:
      return 'BANK_PROGRESS';
  }
}

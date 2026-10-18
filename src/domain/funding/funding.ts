import { ValidationError } from '../../common/errors/app-error';
import { loadRulebook } from '../shared/rulebook-loader';

export interface FundingRulebook {
  version: string;
  allowedMethods: string[];
  referencePrefix: string;
  currency: string;
}
export const FUNDING_RULEBOOK = Symbol('FUNDING_RULEBOOK');
export const loadFundingRulebook = (file?: string): FundingRulebook =>
  loadRulebook<FundingRulebook>(
    'funding.v1.json',
    ['version', 'allowedMethods', 'referencePrefix', 'currency'],
    file,
  );

export interface FundingNotification {
  readonly id: string;
  readonly applicationId: string;
  readonly fundingMethod: string;
  readonly customerTransferReference: string;
  readonly createdAt: Date;
}
export type MatchStatus = 'MATCHED' | 'UNMATCHED';
export interface FundingReceipt {
  readonly id: string;
  readonly applicationId: string;
  readonly providerReceiptKey: string;
  readonly provider: string;
  readonly amountInr: number;
  readonly currency: string;
  readonly sourceAccountFingerprint?: string;
  readonly destinationReference: string;
  readonly valueDate: string;
  readonly matchStatus: MatchStatus;
  readonly mismatchReasons: string[];
  readonly receivedAt: Date;
}
export type FundingStatus = 'AWAITING_FUNDS' | 'PARTIAL' | 'RECONCILED';

/** Deterministic, customer-safe reference: prefix + the tail of the application id. */
export function paymentReference(
  applicationId: string,
  prefix: string,
): string {
  const tail = applicationId
    .replace(/^app_/, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(-8)
    .toUpperCase();
  return `${prefix}-${tail.padStart(8, '0')}`;
}

export function validateFundingMethod(
  method: string,
  rulebook: FundingRulebook,
): void {
  if (!rulebook.allowedMethods.includes(method))
    throw new ValidationError(undefined, {
      details: { field: 'funding_method', allowed: rulebook.allowedMethods },
    });
}

/** A receipt counts only when it came from the verified account, in the product currency, to our reference. */
export function reconcileReceipt(
  r: {
    amountInr: number;
    currency: string;
    sourceAccountFingerprint?: string;
    destinationReference: string;
  },
  expected: {
    currency: string;
    sourceAccountFingerprint?: string;
    paymentReference: string;
  },
): { matchStatus: MatchStatus; reasons: string[] } {
  const reasons: string[] = [];
  if (!(r.amountInr > 0)) reasons.push('non_positive_amount');
  if (r.currency !== expected.currency) reasons.push('currency_mismatch');
  if (r.destinationReference !== expected.paymentReference)
    reasons.push('reference_mismatch');
  if (!expected.sourceAccountFingerprint) reasons.push('no_verified_account');
  else if (r.sourceAccountFingerprint !== expected.sourceAccountFingerprint)
    reasons.push('source_account_mismatch');
  return { matchStatus: reasons.length ? 'UNMATCHED' : 'MATCHED', reasons };
}

export function fundingStatusFor(
  qualifyingInr: number,
  requiredInr: number,
): FundingStatus {
  if (qualifyingInr >= requiredInr && requiredInr > 0) return 'RECONCILED';
  return qualifyingInr > 0 ? 'PARTIAL' : 'AWAITING_FUNDS';
}

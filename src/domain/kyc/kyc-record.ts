import type { IsoDate } from '../shared/iso-date';
import type { KycRelianceRulebook } from './kyc-reliance-rulebook';

export type KycStatus =
  | 'PROCESSING'
  | 'EXISTING_RECORD_AVAILABLE'
  | 'NO_RECORD'
  | 'REVIEW_REQUIRED'
  | 'TECHNICAL_ERROR'
  | 'COMPLETE';
export type KycRoute = 'REUSE' | 'REMEDIATE' | 'FRESH' | 'ASSISTED';

/** Subset of a KRA record safe to show back to the customer for confirmation (never UID tokens). */
export interface KraSummary {
  name?: string;
  dob?: IsoDate;
  statusCode?: string;
  status?: string;
  statusDescription?: string;
  statusDate?: IsoDate;
  ipvFlag?: string;
  kra?: string;
  internalReference?: string;
  correspondenceAddress?: {
    line1?: string;
    line2?: string;
    line3?: string;
    city?: string;
    stateCode?: string;
    pinCode?: string;
  };
  errorCode?: string;
}

export interface KycRecord {
  readonly id: string;
  readonly applicationId: string;
  readonly identityVersion: number;
  readonly provider: 'DIGIO_KRA' | 'DIGIO_STUDIO';
  readonly status: KycStatus;
  readonly route?: KycRoute;
  readonly operationId: string;
  readonly version: number;
  readonly summary?: KraSummary;
  /** Object-storage key of the raw provider response kept as evidence. */
  readonly evidenceKey?: string;
  readonly ipvExemptionBasis?: string;
  readonly safeErrorCategory?: string;
  readonly confirmedAt?: Date;
  readonly updatedAt: Date;
}

export interface RoutingInput {
  found: boolean;
  statusCode?: string;
  errorCode?: string;
  statusDate?: IsoDate;
  ipvFlag?: string;
}

export interface RoutingDecision {
  status: KycStatus;
  route: KycRoute;
  reason: string;
}

/**
 * Maps a KRA outcome to an internal status and route per the reliance rulebook. Anything not explicitly
 * listed routes to review (ASSISTED); a provider failure is a TECHNICAL_ERROR and never a route.
 */
export function routeKyc(
  input: RoutingInput,
  rulebook: KycRelianceRulebook,
  now: Date,
): RoutingDecision {
  if (
    !input.found ||
    (input.errorCode && rulebook.noRecordErrorCodes.includes(input.errorCode))
  ) {
    return {
      status: 'NO_RECORD',
      route: 'FRESH',
      reason: input.errorCode ?? 'no_record',
    };
  }
  const code = input.statusCode ?? '';
  const suffix = code.slice(-2);
  if (code.length !== 3 || !/^\d{3}$/.test(code))
    return {
      status: 'REVIEW_REQUIRED',
      route: 'ASSISTED',
      reason: 'unknown_status_code',
    };
  if (rulebook.reuseStatusSuffixes.includes(suffix)) {
    if (
      input.statusDate &&
      ageDays(input.statusDate, now) > rulebook.maxRecordAgeDays
    )
      return {
        status: 'EXISTING_RECORD_AVAILABLE',
        route: 'REMEDIATE',
        reason: 'record_too_old',
      };
    if (rulebook.requireIpvFlagForReuse && input.ipvFlag !== 'Y')
      return {
        status: 'EXISTING_RECORD_AVAILABLE',
        route: 'REMEDIATE',
        reason: 'ipv_missing',
      };
    return {
      status: 'EXISTING_RECORD_AVAILABLE',
      route: 'REUSE',
      reason: `status_${code}`,
    };
  }
  if (rulebook.remediateStatusSuffixes.includes(suffix))
    return {
      status: 'EXISTING_RECORD_AVAILABLE',
      route: 'REMEDIATE',
      reason: `status_${code}`,
    };
  if (rulebook.freshStatusSuffixes.includes(suffix))
    return { status: 'NO_RECORD', route: 'FRESH', reason: `status_${code}` };
  return {
    status: 'REVIEW_REQUIRED',
    route: 'ASSISTED',
    reason: `unmapped_status_${code}`,
  };
}

function ageDays(date: IsoDate, now: Date): number {
  return (now.getTime() - new Date(`${date}T00:00:00Z`).getTime()) / 86_400_000;
}

/** Screen to show for a KYC record state. */
export function kycNextScreen(
  record: Pick<KycRecord, 'status' | 'route'>,
):
  | 'KYC_PROGRESS'
  | 'CONFIRM_KYC'
  | 'FRESH_KYC'
  | 'ASSISTED_ONBOARDING'
  | 'PROFILE' {
  if (record.status === 'COMPLETE') return 'PROFILE';
  if (record.status === 'PROCESSING') return 'KYC_PROGRESS';
  if (record.status === 'TECHNICAL_ERROR') return 'KYC_PROGRESS';
  switch (record.route) {
    case 'REUSE':
      return 'CONFIRM_KYC';
    case 'REMEDIATE':
    case 'FRESH':
      return 'FRESH_KYC';
    case 'ASSISTED':
      return 'ASSISTED_ONBOARDING';
    default:
      return 'KYC_PROGRESS';
  }
}

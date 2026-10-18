import { loadRulebook } from '../shared/rulebook-loader';

export interface TrackWizzCodebook {
  version: string;
  screeningPurposes: string;
  riskPurpose: string;
  constitutionType: string;
  segment: string;
  screeningProfile: string;
  riskProfile: string;
  occupationTypes: Record<string, string>;
  incomeRanges: Record<string, string>;
  pep: Record<string, string>;
  countries: Record<string, string>;
}
export const TRACKWIZZ_CODEBOOK = Symbol('TRACKWIZZ_CODEBOOK');
export const loadTrackWizzCodebook = (file?: string): TrackWizzCodebook =>
  loadRulebook<TrackWizzCodebook>(
    'trackwizz-codebook.v1.json',
    [
      'version',
      'screeningPurposes',
      'riskPurpose',
      'occupationTypes',
      'incomeRanges',
      'pep',
      'countries',
    ],
    file,
  );

/** Decrypted AS501 response in the two documented shapes (formal wrapper or root example). Nothing is normalised silently. */
export interface As501PurposeResponse {
  Purpose?: string;
  PurposeCode?: string;
  ValidationCode?: string | null;
  ValidationDescription?: string | null;
  ValidationFailureCount?: number | null;
  Data?: As501Data | null;
}
export interface As501Hit {
  Source?: string;
  WatchlistSourceId?: string;
  WatchlistSourceID?: string;
  MatchType?: string;
  Score?: number;
  ConfirmedMatchingAttributes?: string;
}
export interface As501Data {
  SuggestedAction?: string;
  HitsDetected?: string;
  HitsCount?: number;
  ConfirmedHits?: string;
  ConfirmedHit?: string;
  CaseId?: string;
  CaseURL?: string;
  ReportData?: string;
  HitResponse?: As501Hit[];
  RiskValue?: string;
  NextRiskReviewDate?: string;
}
export interface As501CustomerResponse {
  SourceSystemCustomerCode?: string;
  ApplicationRefNumber?: string;
  ValidationOutcome?: string;
  SuggestedAction?: string;
  PurposeResponse?: As501PurposeResponse[];
}
export interface As501Body {
  OverallStatus?: string;
  CustomerResponse?: As501CustomerResponse[];
}
export interface As501Response extends As501Body {
  RequestId?: string;
  ValidationCode?: string | null;
  ValidationDescription?: string | null;
  DecryptedData?: As501Body | null;
}

export type ScreeningOutcome = 'PROCEED' | 'REVIEW' | 'STOP' | 'ERROR';
export interface ScreeningEvaluation {
  outcome: ScreeningOutcome;
  /** Safe, non-identifying category when the outcome is not a clean decision. */
  category?: string;
  suggestedAction?: string;
  hitsCount?: number;
  confirmedHit?: boolean;
  providerCaseId?: string;
  providerCaseUrl?: string;
  matchTypes: string[];
}
export interface Expected {
  requestId: string;
  customerCode: string;
  purposeCodes: string[];
}

const body = (
  r: As501Response,
): { body: As501Body; wrapper: 'formal' | 'root' } | null => {
  if (r.DecryptedData && typeof r.DecryptedData === 'object')
    return { body: r.DecryptedData, wrapper: 'formal' };
  if (r.OverallStatus !== undefined || r.CustomerResponse !== undefined)
    return { body: r, wrapper: 'root' };
  return null;
};

/** Validation checks every AS501 interpretation must pass before any `Data` is read. Returns the customer entry or a category. */
export function validateAs501(
  r: As501Response,
  expected: Expected,
):
  | {
      customer: As501CustomerResponse;
      purposes: Map<string, As501PurposeResponse>;
    }
  | { category: string } {
  const b = body(r);
  if (!b) return { category: 'unexpected_response_shape' };
  if ((r.RequestId ?? '') !== expected.requestId)
    return { category: 'request_id_mismatch' };
  if (r.ValidationCode && String(r.ValidationCode).toLowerCase() !== 'null')
    return { category: 'request_rejected' };
  if ((b.body.OverallStatus ?? '').toLowerCase() !== 'acceptedbytw')
    return { category: 'rejected_by_tw' };
  const customer = (b.body.CustomerResponse ?? []).find(
    (c) => c.SourceSystemCustomerCode === expected.customerCode,
  );
  if (!customer) return { category: 'customer_mismatch' };
  if ((customer.ValidationOutcome ?? '').toLowerCase() !== 'success')
    return { category: 'customer_validation_failed' };
  const purposes = new Map<string, As501PurposeResponse>();
  for (const p of customer.PurposeResponse ?? [])
    if (p.PurposeCode) purposes.set(p.PurposeCode, p);
  for (const code of expected.purposeCodes) {
    const p = purposes.get(code);
    if (!p) return { category: `purpose_${code}_missing` };
    if (
      (p.ValidationFailureCount ?? 0) !== 0 ||
      (p.ValidationCode &&
        p.ValidationCode !== '' &&
        p.ValidationCode.toLowerCase() !== 'null')
    )
      return { category: `purpose_${code}_validation_failed` };
  }
  return { customer, purposes };
}

/**
 * Purpose 01/03 decides. `SuggestedAction` may sit on the purpose `Data` (formal) or the customer (examples); both
 * present and different, or neither present, is an integration exception. Purpose 04 `Data: null` is tolerated.
 */
export function evaluateScreening(
  r: As501Response,
  expected: Expected,
): ScreeningEvaluation {
  const v = validateAs501(r, expected);
  if ('category' in v)
    return { outcome: 'ERROR', category: v.category, matchTypes: [] };
  const initial = expected.purposeCodes.find((c) => c === '01' || c === '03');
  const data = initial
    ? (v.purposes.get(initial)?.Data ?? undefined)
    : undefined;
  const fromData = data?.SuggestedAction?.trim();
  const fromCustomer = v.customer.SuggestedAction?.trim();
  if (
    fromData &&
    fromCustomer &&
    fromData.toLowerCase() !== fromCustomer.toLowerCase()
  )
    return {
      outcome: 'ERROR',
      category: 'suggested_action_conflict',
      matchTypes: [],
    };
  const action = (fromData ?? fromCustomer ?? '').toLowerCase();
  const outcome: ScreeningOutcome | undefined =
    action === 'proceed'
      ? 'PROCEED'
      : action === 'review'
        ? 'REVIEW'
        : action === 'stop'
          ? 'STOP'
          : undefined;
  if (!outcome)
    return {
      outcome: 'ERROR',
      category: action
        ? 'unknown_suggested_action'
        : 'suggested_action_missing',
      matchTypes: [],
    };
  const confirmedRaw = data?.ConfirmedHits ?? data?.ConfirmedHit;
  const hits = data?.HitResponse ?? [];
  const evaluation: ScreeningEvaluation = {
    outcome,
    suggestedAction: fromData ?? fromCustomer,
    hitsCount: typeof data?.HitsCount === 'number' ? data.HitsCount : undefined,
    confirmedHit:
      confirmedRaw === undefined
        ? undefined
        : String(confirmedRaw).toLowerCase() === 'yes',
    providerCaseId: data?.CaseId,
    providerCaseUrl: data?.CaseURL,
    matchTypes: [
      ...new Set(hits.map((h) => h.MatchType).filter((m): m is string => !!m)),
    ],
  };
  // Proceed with hits reported is contradictory; hold it for a human rather than clear it.
  if (
    outcome === 'PROCEED' &&
    ((evaluation.hitsCount ?? 0) > 0 || evaluation.confirmedHit)
  )
    return { ...evaluation, outcome: 'REVIEW', category: 'proceed_with_hits' };
  return evaluation;
}

export type RiskOutcome = 'PROCEED' | 'REVIEW' | 'ERROR';
export interface RiskEvaluation {
  outcome: RiskOutcome;
  category?: string;
  riskValue?: 'High' | 'Medium' | 'Low';
  nextReviewDate?: string;
  reportAvailable: boolean;
}
/** Purpose 06 only. High is enhanced due diligence (review), never automatic rejection. */
export function evaluateRiskRating(
  r: As501Response,
  expected: Expected,
  eddRiskValues: string[] = ['High'],
): RiskEvaluation {
  const v = validateAs501(r, expected);
  if ('category' in v)
    return { outcome: 'ERROR', category: v.category, reportAvailable: false };
  const data = v.purposes.get(expected.purposeCodes[0])?.Data;
  const raw = (data?.RiskValue ?? '').trim();
  const riskValue = (['High', 'Medium', 'Low'] as const).find(
    (x) => x.toLowerCase() === raw.toLowerCase(),
  );
  if (!riskValue)
    return {
      outcome: 'ERROR',
      category: raw ? 'unknown_risk_value' : 'risk_value_missing',
      reportAvailable: !!data?.ReportData,
    };
  return {
    outcome: eddRiskValues.includes(riskValue) ? 'REVIEW' : 'PROCEED',
    riskValue,
    nextReviewDate: data?.NextRiskReviewDate || undefined,
    reportAvailable: !!data?.ReportData,
  };
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
/** TrackWizz dates are DD-MMM-YYYY. */
export function toTrackWizzDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}-${MONTHS[Number(m) - 1]}-${y}`;
}
export function splitName(legalName: string): {
  firstName: string;
  middleName: string;
  lastName: string;
} {
  const parts = legalName.trim().split(/\s+/);
  if (parts.length === 1)
    return { firstName: parts[0], middleName: '', lastName: '' };
  if (parts.length === 2)
    return { firstName: parts[0], middleName: '', lastName: parts[1] };
  return {
    firstName: parts[0],
    middleName: parts.slice(1, -1).join(' '),
    lastName: parts[parts.length - 1],
  };
}

import type { IpvRulebook } from './ipv-rulebook';

export type VerificationType = 'SELFIE_LIVENESS' | 'ASSISTED_IPV';
export type VerificationStatus =
  | 'REQUESTED'
  | 'PROCESSING'
  | 'PASSED'
  | 'FAILED'
  | 'EXEMPT'
  | 'REVIEW_REQUIRED';

export interface AdditionalVerification {
  readonly id: string;
  readonly applicationId: string;
  readonly type: VerificationType;
  readonly status: VerificationStatus;
  readonly selfieDocumentId?: string;
  readonly referenceDocumentId?: string;
  readonly providerSessionId?: string;
  readonly exemptionBasis?: string;
  readonly livenessScore?: number;
  readonly faceMatchConfidence?: number;
  readonly thresholdVersion: string;
  readonly safeErrorCategory?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface LivenessOutcome {
  result: 'PASS' | 'FAIL' | 'UNKNOWN';
  score: number;
}
export interface FaceMatchOutcome {
  matchResult: 'matched' | 'not_matched' | 'failed' | 'none';
  confidence: number;
}

export type IpvEvaluation =
  | { status: 'PASSED' }
  | { status: 'FAILED' | 'REVIEW_REQUIRED'; category: string };

/** Liveness must pass its threshold; face match, when a reference exists, must be matched above its threshold. */
export function evaluateIpv(
  liveness: LivenessOutcome,
  faceMatch: FaceMatchOutcome | undefined,
  rulebook: IpvRulebook,
): IpvEvaluation {
  if (liveness.result === 'UNKNOWN')
    return { status: 'REVIEW_REQUIRED', category: 'liveness_inconclusive' };
  if (liveness.result !== 'PASS' || liveness.score < rulebook.minLivenessScore)
    return { status: 'FAILED', category: 'liveness_failed' };
  if (!faceMatch)
    return { status: 'REVIEW_REQUIRED', category: 'no_reference_image' };
  if (faceMatch.matchResult === 'failed' || faceMatch.matchResult === 'none')
    return { status: 'REVIEW_REQUIRED', category: 'face_match_inconclusive' };
  if (
    faceMatch.matchResult !== 'matched' ||
    faceMatch.confidence < rulebook.minFaceMatchConfidence
  )
    return { status: 'FAILED', category: 'face_mismatch' };
  return { status: 'PASSED' };
}

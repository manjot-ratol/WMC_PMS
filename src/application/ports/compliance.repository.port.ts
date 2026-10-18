import type { TransactionContext } from './unit-of-work.port';

export type ComplianceRunStatus =
  'QUEUED' | 'RUNNING' | 'PROCEED' | 'REVIEW' | 'STOP' | 'ERROR' | 'SUPERSEDED';

export interface ScreeningRunRecord {
  id: string;
  applicationId: string;
  identityVersion: number;
  screeningPolicyVersion: string;
  status: ComplianceRunStatus;
  suggestedAction?: string;
  hitsCount?: number;
  confirmedHit?: boolean;
  providerRequestId?: string;
  evidenceKey?: string;
  safeErrorCategory?: string;
  createdAt: Date;
  completedAt?: Date;
}
export interface AmlAssessmentRecord {
  id: string;
  applicationId: string;
  identityVersion: number;
  profileVersion: number;
  declarationVersion: number;
  policyVersion: string;
  status: ComplianceRunStatus;
  riskValue?: string;
  nextReviewDate?: Date;
  providerRequestId?: string;
  evidenceKey?: string;
  safeErrorCategory?: string;
  createdAt: Date;
  completedAt?: Date;
}

export type ComplianceKind = 'SCREENING' | 'AML';
export type CaseKind = 'SCREENING_HIT' | 'AML_HIGH_RISK';
export type CaseStatus = 'OPEN' | 'UNDER_REVIEW' | 'CLOSED';
export interface ComplianceCaseRecord {
  id: string;
  applicationId: string;
  kind: CaseKind;
  sourceRunId: string;
  severity: 'HIGH' | 'MEDIUM';
  status: CaseStatus;
  providerCaseId?: string;
  providerCaseUrl?: string;
  summary: Record<string, unknown>;
  createdAt: Date;
  closedAt?: Date;
}
export interface ReviewDecisionRecord {
  id: string;
  caseId: string;
  applicationId: string;
  reviewerId: string;
  decision: 'PROCEED' | 'HOLD' | 'REJECT';
  reason: string;
  createdAt: Date;
}

/** Restricted compliance records: runs consumed by the TrackWizz jobs, cases for human review. */
export interface ComplianceRepositoryPort {
  findScreeningRun(
    id: string,
    tx?: TransactionContext,
  ): Promise<ScreeningRunRecord | null>;
  findAmlAssessment(
    id: string,
    tx?: TransactionContext,
  ): Promise<AmlAssessmentRecord | null>;
  updateScreeningRun(
    run: ScreeningRunRecord,
    tx?: TransactionContext,
  ): Promise<void>;
  updateAmlAssessment(
    a: AmlAssessmentRecord,
    tx?: TransactionContext,
  ): Promise<void>;
  createCase(c: ComplianceCaseRecord, tx?: TransactionContext): Promise<void>;
  findCase(
    id: string,
    tx?: TransactionContext,
  ): Promise<ComplianceCaseRecord | null>;
  listOpenCases(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<ComplianceCaseRecord[]>;
  updateCase(c: ComplianceCaseRecord, tx?: TransactionContext): Promise<void>;
  createDecision(
    d: ReviewDecisionRecord,
    tx?: TransactionContext,
  ): Promise<void>;
  createScreeningRun(
    run: ScreeningRunRecord,
    tx?: TransactionContext,
  ): Promise<void>;
  createAmlAssessment(
    a: AmlAssessmentRecord,
    tx?: TransactionContext,
  ): Promise<void>;
  /** Marks earlier QUEUED/RUNNING rows for the application as SUPERSEDED (inputs changed); optionally one kind only. */
  supersedeOpen(
    applicationId: string,
    tx?: TransactionContext,
    kind?: ComplianceKind,
  ): Promise<void>;
  latestScreeningRun(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<ScreeningRunRecord | null>;
  latestAmlAssessment(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<AmlAssessmentRecord | null>;
}
export const COMPLIANCE_REPOSITORY = Symbol('COMPLIANCE_REPOSITORY');

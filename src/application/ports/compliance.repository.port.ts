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

/** Restricted compliance records. Queued rows are consumed by the Phase 7 TrackWizz jobs. */
export interface ComplianceRepositoryPort {
  createScreeningRun(
    run: ScreeningRunRecord,
    tx?: TransactionContext,
  ): Promise<void>;
  createAmlAssessment(
    a: AmlAssessmentRecord,
    tx?: TransactionContext,
  ): Promise<void>;
  /** Marks earlier QUEUED/RUNNING rows for the application as SUPERSEDED (inputs changed). */
  supersedeOpen(applicationId: string, tx?: TransactionContext): Promise<void>;
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

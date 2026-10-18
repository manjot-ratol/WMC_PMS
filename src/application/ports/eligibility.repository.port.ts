import type {
  EligibilityDecision,
  EligibilityInput,
} from '../../domain/eligibility/eligibility-engine';
import type { TransactionContext } from './unit-of-work.port';

export interface EligibilityDecisionRecord extends EligibilityDecision {
  id: string;
  applicationId: string;
  version: number;
  input: EligibilityInput;
  decidedAt: Date;
}

export interface EligibilityRepositoryPort {
  append(
    record: EligibilityDecisionRecord,
    tx?: TransactionContext,
  ): Promise<void>;
  latest(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<EligibilityDecisionRecord | null>;
}
export const ELIGIBILITY_REPOSITORY = Symbol('ELIGIBILITY_REPOSITORY');

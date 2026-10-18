import type {
  InvestmentApproach,
  SuitabilityAssessment,
} from '../../domain/suitability/suitability';
import type { TransactionContext } from './unit-of-work.port';

export interface SuitabilityRepositoryPort {
  appendAssessment(
    a: SuitabilityAssessment,
    tx?: TransactionContext,
  ): Promise<void>;
  findAssessment(
    id: string,
    tx?: TransactionContext,
  ): Promise<SuitabilityAssessment | null>;
  latestAssessment(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<SuitabilityAssessment | null>;
  appendApproach(a: InvestmentApproach, tx?: TransactionContext): Promise<void>;
  latestApproach(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<InvestmentApproach | null>;
}
export const SUITABILITY_REPOSITORY = Symbol('SUITABILITY_REPOSITORY');

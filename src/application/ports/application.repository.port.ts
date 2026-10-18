import type { OnboardingApplication } from '../../domain/onboarding/application';
import type { TransactionContext } from './unit-of-work.port';

export interface ApplicationRepositoryPort {
  findById(
    id: string,
    tx?: TransactionContext,
  ): Promise<OnboardingApplication | null>;
  findInProgressByCustomer(
    customerId: string,
    tx?: TransactionContext,
  ): Promise<OnboardingApplication | null>;
  listIdsByCustomer(
    customerId: string,
    tx?: TransactionContext,
  ): Promise<string[]>;
  create(app: OnboardingApplication, tx?: TransactionContext): Promise<void>;
  /** Persists `app` only if the stored version still equals `expectedVersion` (the version loaded). */
  saveWithVersionCheck(
    app: OnboardingApplication,
    expectedVersion: number,
    tx?: TransactionContext,
  ): Promise<void>;
}
export const APPLICATION_REPOSITORY = Symbol('APPLICATION_REPOSITORY');

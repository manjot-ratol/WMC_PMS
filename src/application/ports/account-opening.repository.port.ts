import type {
  AccountOpeningRun,
  RegistrySubmission,
  UnderlyingAccount,
} from '../../domain/account-opening/account-opening';
import type { TransactionContext } from './unit-of-work.port';

export interface AccountOpeningRepositoryPort {
  createRun(run: AccountOpeningRun, tx?: TransactionContext): Promise<void>;
  findRun(
    id: string,
    tx?: TransactionContext,
  ): Promise<AccountOpeningRun | null>;
  latestRun(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<AccountOpeningRun | null>;
  updateRun(run: AccountOpeningRun, tx?: TransactionContext): Promise<void>;
  createSubmission(
    s: RegistrySubmission,
    tx?: TransactionContext,
  ): Promise<void>;
  findSubmissionByReference(
    ref: { providerRequestId?: string; clientReferenceId?: string },
    tx?: TransactionContext,
  ): Promise<RegistrySubmission | null>;
  listSubmissions(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<RegistrySubmission[]>;
  updateSubmission(
    s: RegistrySubmission,
    tx?: TransactionContext,
  ): Promise<void>;
  /** Inserts when the provider receipt key is new; otherwise returns the stored row untouched. */
  insertUnderlyingAccountIfNew(
    a: UnderlyingAccount,
    tx?: TransactionContext,
  ): Promise<{ inserted: boolean; account: UnderlyingAccount }>;
  listUnderlyingAccounts(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<UnderlyingAccount[]>;
}
export const ACCOUNT_OPENING_REPOSITORY = Symbol('ACCOUNT_OPENING_REPOSITORY');

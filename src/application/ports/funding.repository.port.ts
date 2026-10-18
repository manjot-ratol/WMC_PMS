import type {
  FundingNotification,
  FundingReceipt,
} from '../../domain/funding/funding';
import type { TransactionContext } from './unit-of-work.port';

export interface FundingRepositoryPort {
  createNotification(
    n: FundingNotification,
    tx?: TransactionContext,
  ): Promise<void>;
  latestNotification(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<FundingNotification | null>;
  /** Inserts when the provider receipt key is new; otherwise returns the stored receipt untouched. */
  insertReceiptIfNew(
    r: FundingReceipt,
    tx?: TransactionContext,
  ): Promise<{ inserted: boolean; receipt: FundingReceipt }>;
  listReceipts(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<FundingReceipt[]>;
  sumMatched(applicationId: string, tx?: TransactionContext): Promise<number>;
}
export const FUNDING_REPOSITORY = Symbol('FUNDING_REPOSITORY');

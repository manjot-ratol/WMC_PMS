import type { ReviewSnapshot } from '../../domain/review/review-snapshot';
import type { TransactionContext } from './unit-of-work.port';

export interface ReviewRepositoryPort {
  create(s: ReviewSnapshot, tx?: TransactionContext): Promise<void>;
  findById(id: string, tx?: TransactionContext): Promise<ReviewSnapshot | null>;
  current(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<ReviewSnapshot | null>;
  supersedeCurrent(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<void>;
}
export const REVIEW_REPOSITORY = Symbol('REVIEW_REPOSITORY');

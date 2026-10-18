import type { Nomination } from '../../domain/nomination/nomination';
import type { TransactionContext } from './unit-of-work.port';

export interface NominationRepositoryPort {
  append(nomination: Nomination, tx?: TransactionContext): Promise<void>;
  latest(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<Nomination | null>;
}
export const NOMINATION_REPOSITORY = Symbol('NOMINATION_REPOSITORY');

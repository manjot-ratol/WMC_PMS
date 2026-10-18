import type { Declarations } from '../../domain/profile/declarations';
import type { CustomerProfile } from '../../domain/profile/profile';
import type { TransactionContext } from './unit-of-work.port';

export interface ProfileRepositoryPort {
  append(profile: CustomerProfile, tx?: TransactionContext): Promise<void>;
  latest(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<CustomerProfile | null>;
}
export const PROFILE_REPOSITORY = Symbol('PROFILE_REPOSITORY');

export interface DeclarationsRepositoryPort {
  append(declarations: Declarations, tx?: TransactionContext): Promise<void>;
  latest(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<Declarations | null>;
}
export const DECLARATIONS_REPOSITORY = Symbol('DECLARATIONS_REPOSITORY');

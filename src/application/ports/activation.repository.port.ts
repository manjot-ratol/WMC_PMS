import type { Activation } from '../../domain/activation/activation';
import type { TransactionContext } from './unit-of-work.port';

export interface ActivationRepositoryPort {
  /** One activation per application: a second insert must fail at the database (unique application id). */
  create(a: Activation, tx?: TransactionContext): Promise<void>;
  findByApplication(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<Activation | null>;
}
export const ACTIVATION_REPOSITORY = Symbol('ACTIVATION_REPOSITORY');

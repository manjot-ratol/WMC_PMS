import type { Customer } from '../../domain/identity/customer';
import type { TransactionContext } from './unit-of-work.port';

export interface CustomerRepositoryPort {
  findById(id: string, tx?: TransactionContext): Promise<Customer | null>;
  findByPhoneFingerprint(
    fingerprint: string,
    tx?: TransactionContext,
  ): Promise<Customer | null>;
  create(customer: Customer, tx?: TransactionContext): Promise<void>;
  /** Persists `customer` only if the stored version still equals `expectedVersion` (the version loaded); otherwise StaleVersionError. */
  saveWithVersionCheck(
    customer: Customer,
    expectedVersion: number,
    tx?: TransactionContext,
  ): Promise<void>;
}
export const CUSTOMER_REPOSITORY = Symbol('CUSTOMER_REPOSITORY');

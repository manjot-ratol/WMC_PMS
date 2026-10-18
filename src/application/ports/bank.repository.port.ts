import type {
  BankAccount,
  BankVerification,
} from '../../domain/bank/bank-account';
import type { TransactionContext } from './unit-of-work.port';

export interface BankRepositoryPort {
  createAccount(account: BankAccount, tx?: TransactionContext): Promise<void>;
  findAccount(id: string, tx?: TransactionContext): Promise<BankAccount | null>;
  findAccountByFingerprint(
    applicationId: string,
    fingerprint: string,
    tx?: TransactionContext,
  ): Promise<BankAccount | null>;
  createVerification(
    v: BankVerification,
    tx?: TransactionContext,
  ): Promise<void>;
  findVerification(
    id: string,
    tx?: TransactionContext,
  ): Promise<BankVerification | null>;
  latestVerification(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<BankVerification | null>;
  updateVerification(
    v: BankVerification,
    tx?: TransactionContext,
  ): Promise<void>;
  countVerifications(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<number>;
}
export const BANK_REPOSITORY = Symbol('BANK_REPOSITORY');

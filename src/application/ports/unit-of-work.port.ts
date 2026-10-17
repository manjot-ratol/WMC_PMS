import type { TransactionContext } from '../../infrastructure/persistence/transaction-context';

/** Runs a function inside one database transaction; repositories accept the context as their last argument. */
export interface UnitOfWork {
  run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T>;
}
export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');
export type { TransactionContext };

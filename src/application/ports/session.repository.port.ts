import type { TransactionContext } from './unit-of-work.port';

export interface SessionRecord {
  id: string;
  tokenHash: string;
  customerId: string;
  expiresAt: Date;
}

export interface SessionRepositoryPort {
  create(session: SessionRecord, tx?: TransactionContext): Promise<void>;
  revoke(tokenHash: string): Promise<void>;
}
export const SESSION_REPOSITORY = Symbol('SESSION_REPOSITORY');

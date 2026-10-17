import type { TransactionContext } from './unit-of-work.port';

export type ActorType = 'CUSTOMER' | 'SYSTEM' | 'REVIEWER' | 'PARTNER';

export interface AuditEventInput {
  actorType: ActorType;
  actorId?: string;
  action: string;
  aggregateType: string;
  aggregateId: string;
  details?: Record<string, unknown>;
}

/** Append-only. There is deliberately no update or delete. */
export interface AuditPort {
  append(event: AuditEventInput, tx?: TransactionContext): Promise<void>;
}
export const AUDIT = Symbol('AUDIT');

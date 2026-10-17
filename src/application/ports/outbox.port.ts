import type { TransactionContext } from './unit-of-work.port';

export interface OutboxEventInput {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export interface OutboxRow extends OutboxEventInput {
  id: string;
  correlationId: string;
  createdAt: Date;
  attempts: number;
}

export interface OutboxPort {
  add(event: OutboxEventInput, tx?: TransactionContext): Promise<string>;
  claimBatch(limit: number): Promise<OutboxRow[]>;
  markDispatched(id: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
}
export const OUTBOX = Symbol('OUTBOX');

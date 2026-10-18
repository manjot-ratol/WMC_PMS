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
  /** Dead-letters a row (no consumer, or poison); it is never claimed again. */
  markDead(id: string, reason: string): Promise<void>;
}

/** Rows failing more often than this are left for operators instead of being reclaimed forever. */
export const OUTBOX_MAX_ATTEMPTS = 10;
export const OUTBOX = Symbol('OUTBOX');

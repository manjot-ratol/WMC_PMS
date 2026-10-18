import type { AdditionalVerification } from '../../domain/ipv/additional-verification';
import type { TransactionContext } from './unit-of-work.port';

export interface TaskRecord {
  id: string;
  applicationId: string;
  category: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'UNDER_REVIEW' | 'RESOLVED';
  details?: Record<string, unknown>;
  createdAt: Date;
  resolvedAt?: Date;
}

export interface VerificationRepositoryPort {
  create(v: AdditionalVerification, tx?: TransactionContext): Promise<void>;
  findById(
    id: string,
    tx?: TransactionContext,
  ): Promise<AdditionalVerification | null>;
  latestForApplication(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<AdditionalVerification | null>;
  update(v: AdditionalVerification, tx?: TransactionContext): Promise<void>;
  countByType(
    applicationId: string,
    type: AdditionalVerification['type'],
    tx?: TransactionContext,
  ): Promise<number>;
}
export const VERIFICATION_REPOSITORY = Symbol('VERIFICATION_REPOSITORY');

export interface TaskResponseRecord {
  id: string;
  taskId: string;
  applicationId: string;
  responseType: 'DOCUMENT' | 'TEXT';
  documentIds: string[];
  text?: string;
  submittedAt: Date;
}

export interface TaskRepositoryPort {
  create(task: TaskRecord, tx?: TransactionContext): Promise<void>;
  findById(id: string, tx?: TransactionContext): Promise<TaskRecord | null>;
  update(task: TaskRecord, tx?: TransactionContext): Promise<void>;
  listOpen(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<TaskRecord[]>;
  createResponse(r: TaskResponseRecord, tx?: TransactionContext): Promise<void>;
}
export const TASK_REPOSITORY = Symbol('TASK_REPOSITORY');

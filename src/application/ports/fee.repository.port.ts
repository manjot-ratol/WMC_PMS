import type { Acknowledgement } from '../../domain/documents/document-pack';
import type { FeeIllustration } from '../../domain/fees/fee-engine';
import type { TransactionContext } from './unit-of-work.port';

export interface FeeIllustrationRecord extends FeeIllustration {
  id: string;
  applicationId: string;
  createdAt: Date;
}
export interface FeeRepositoryPort {
  createIllustration(
    r: FeeIllustrationRecord,
    tx?: TransactionContext,
  ): Promise<void>;
  appendAcknowledgement(
    a: Acknowledgement,
    tx?: TransactionContext,
  ): Promise<void>;
  latestAcknowledgement(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<Acknowledgement | null>;
}
export const FEE_REPOSITORY = Symbol('FEE_REPOSITORY');

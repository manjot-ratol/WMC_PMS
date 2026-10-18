import type { SigningSession } from '../../domain/signing/signing-session';
import type { TransactionContext } from './unit-of-work.port';

export interface SigningRepositoryPort {
  create(s: SigningSession, tx?: TransactionContext): Promise<void>;
  findById(id: string, tx?: TransactionContext): Promise<SigningSession | null>;
  findByProviderRequestId(
    providerRequestId: string,
    tx?: TransactionContext,
  ): Promise<SigningSession | null>;
  latestForSnapshot(
    snapshotId: string,
    tx?: TransactionContext,
  ): Promise<SigningSession | null>;
  latestForApplication(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<SigningSession | null>;
  update(s: SigningSession, tx?: TransactionContext): Promise<void>;
}
export const SIGNING_REPOSITORY = Symbol('SIGNING_REPOSITORY');

import type { KycRecord } from '../../domain/kyc/kyc-record';
import type { KycSession } from '../../domain/kyc/kyc-session';
import type { TransactionContext } from './unit-of-work.port';

export interface KycRecordRepositoryPort {
  create(record: KycRecord, tx?: TransactionContext): Promise<void>;
  findById(id: string, tx?: TransactionContext): Promise<KycRecord | null>;
  latestForApplication(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<KycRecord | null>;
  saveWithVersionCheck(
    record: KycRecord,
    expectedVersion: number,
    tx?: TransactionContext,
  ): Promise<void>;
}
export const KYC_RECORD_REPOSITORY = Symbol('KYC_RECORD_REPOSITORY');

export interface KycSessionRepositoryPort {
  create(session: KycSession, tx?: TransactionContext): Promise<void>;
  findById(id: string, tx?: TransactionContext): Promise<KycSession | null>;
  findByProviderRequestId(
    providerRequestId: string,
    tx?: TransactionContext,
  ): Promise<KycSession | null>;
  latestForApplication(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<KycSession | null>;
  update(session: KycSession, tx?: TransactionContext): Promise<void>;
}
export const KYC_SESSION_REPOSITORY = Symbol('KYC_SESSION_REPOSITORY');

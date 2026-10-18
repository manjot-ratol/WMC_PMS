import type { IdentityVersion } from '../../domain/kyc/identity-version';
import type { TransactionContext } from './unit-of-work.port';

export interface IdentityRepositoryPort {
  append(identity: IdentityVersion, tx?: TransactionContext): Promise<void>;
  latest(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<IdentityVersion | null>;
  /** Application ids (other than `exceptApplicationId`) that submitted the same PAN. */
  otherApplicationsWithPan(
    panFingerprint: string,
    exceptApplicationId: string,
    tx?: TransactionContext,
  ): Promise<string[]>;
}
export const IDENTITY_REPOSITORY = Symbol('IDENTITY_REPOSITORY');

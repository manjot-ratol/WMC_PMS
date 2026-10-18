import type {
  Challenge,
  ChallengeChannel,
} from '../../domain/identity/challenge';
import type { TransactionContext } from './unit-of-work.port';

export interface ChallengeRepositoryPort {
  create(challenge: Challenge, tx?: TransactionContext): Promise<void>;
  findById(id: string, tx?: TransactionContext): Promise<Challenge | null>;
  update(challenge: Challenge, tx?: TransactionContext): Promise<void>;
  /** Challenges still awaiting verification for an application on a channel (DISPATCH_PENDING/DISPATCHED/DISPATCH_FAILED). */
  findPendingByApplication(
    applicationId: string,
    channel: ChallengeChannel,
    tx?: TransactionContext,
  ): Promise<Challenge[]>;
}
export const CHALLENGE_REPOSITORY = Symbol('CHALLENGE_REPOSITORY');

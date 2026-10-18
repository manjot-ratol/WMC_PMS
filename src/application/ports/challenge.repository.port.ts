import type { Challenge } from '../../domain/identity/challenge';
import type { TransactionContext } from './unit-of-work.port';

export interface ChallengeRepositoryPort {
  create(challenge: Challenge, tx?: TransactionContext): Promise<void>;
  findById(id: string, tx?: TransactionContext): Promise<Challenge | null>;
  update(challenge: Challenge, tx?: TransactionContext): Promise<void>;
}
export const CHALLENGE_REPOSITORY = Symbol('CHALLENGE_REPOSITORY');

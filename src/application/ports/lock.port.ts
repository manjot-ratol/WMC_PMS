export interface LockPort {
  /** Runs fn while holding an exclusive lock; throws LockUnavailableError if another holder exists. */
  withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T>;
}
export const LOCK = Symbol('LOCK');

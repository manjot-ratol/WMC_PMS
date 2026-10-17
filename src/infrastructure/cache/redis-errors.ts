import { DependencyUnavailableError } from '../../common/errors/app-error';

/** Wraps any Redis failure as a 503 so callers fail closed instead of guessing. */
export async function failClosed<T>(
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw new DependencyUnavailableError(undefined, {
      cause: err,
      details: { dependency: 'redis', operation },
    });
  }
}

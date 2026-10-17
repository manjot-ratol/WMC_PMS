export interface PublishOptions {
  /** Stable id makes the publish idempotent (BullMQ dedupes by jobId). */
  jobId?: string;
  delayMs?: number;
}

export interface JobPublisherPort {
  publish<T>(
    queue: string,
    name: string,
    payload: T,
    opts?: PublishOptions,
  ): Promise<void>;
}
export const JOB_PUBLISHER = Symbol('JOB_PUBLISHER');

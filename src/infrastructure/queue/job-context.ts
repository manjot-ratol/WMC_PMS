/** Every job payload travels inside this envelope so the worker can restore the originating correlation id. */
export interface JobEnvelope<T> {
  correlationId: string;
  payload: T;
}

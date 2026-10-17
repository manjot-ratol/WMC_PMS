export interface InboxPort {
  insertIfNew(
    provider: string,
    eventKey: string,
    payload: unknown,
  ): Promise<{ inserted: boolean; id: string }>;
  markProcessed(id: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
}
export const INBOX = Symbol('INBOX');

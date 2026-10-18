export interface InboxRow {
  id: string;
  provider: string;
  eventKey: string;
  payload: unknown;
  status: 'RECEIVED' | 'PROCESSED' | 'FAILED';
}

export interface InboxPort {
  get(id: string): Promise<InboxRow | null>;
  insertIfNew(
    provider: string,
    eventKey: string,
    payload: unknown,
  ): Promise<{ inserted: boolean; id: string }>;
  markProcessed(id: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
}
export const INBOX = Symbol('INBOX');

export interface IdempotencyRecord {
  principalId: string;
  route: string;
  key: string;
  requestHash: string;
  statusCode: number;
  responseBody: unknown;
  expiresAt: Date;
}

export interface IdempotencyPort {
  find(
    principalId: string,
    route: string,
    key: string,
  ): Promise<IdempotencyRecord | null>;
  save(record: IdempotencyRecord): Promise<void>;
}
export const IDEMPOTENCY = Symbol('IDEMPOTENCY');

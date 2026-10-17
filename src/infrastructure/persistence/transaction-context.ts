import type { Prisma } from '@prisma/client';

export type PrismaTx = Prisma.TransactionClient;

/** Opaque handle to a running transaction. Only repositories unwrap it. */
export class TransactionContext {
  constructor(private readonly client: PrismaTx) {}

  /** @internal for repositories only */
  unwrap(): PrismaTx {
    return this.client;
  }
}

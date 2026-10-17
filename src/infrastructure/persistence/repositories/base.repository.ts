import type { PrismaService } from '../prisma.service';
import type { PrismaTx, TransactionContext } from '../transaction-context';

/** Resolves the client to use: the transaction if one is supplied, otherwise the root client. */
export function clientOf(
  prisma: PrismaService,
  tx?: TransactionContext,
): PrismaTx {
  return tx ? tx.unwrap() : prisma;
}

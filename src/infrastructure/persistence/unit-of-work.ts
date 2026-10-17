import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { UnitOfWork } from '../../application/ports/unit-of-work.port';
import { PrismaService } from './prisma.service';
import { TransactionContext } from './transaction-context';

/** Prisma interactive transaction. Nested run() calls join the ambient transaction. */
@Injectable()
export class PrismaUnitOfWork implements UnitOfWork {
  private readonly ambient = new AsyncLocalStorage<TransactionContext>();

  constructor(private readonly prisma: PrismaService) {}

  run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    const current = this.ambient.getStore();
    if (current) return fn(current);
    return this.prisma.$transaction(
      (client) => {
        const ctx = new TransactionContext(client);
        return this.ambient.run(ctx, () => fn(ctx));
      },
      { maxWait: 5_000, timeout: 30_000 },
    );
  }
}

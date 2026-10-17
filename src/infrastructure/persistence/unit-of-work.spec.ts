import { randomUUID } from 'node:crypto';
import { CorrelationStore } from '../../common/correlation/correlation.store';
import {
  describeWithDb,
  loadTestEnv,
  migrateTestDb,
} from '../../../test/support/db';
import { PrismaService } from './prisma.service';
import { AuditRepository } from './repositories/audit.repository';
import { OutboxRepository } from './repositories/outbox.repository';
import { PrismaUnitOfWork } from './unit-of-work';

// DB-backed specs run in parallel workers against one database: every assertion is scoped to this file's ids.
describeWithDb('PrismaUnitOfWork (docker postgres)', () => {
  let prisma: PrismaService;
  let uow: PrismaUnitOfWork;
  let outbox: OutboxRepository;
  let audit: AuditRepository;
  const store = new CorrelationStore();
  const ns = `uow-${randomUUID()}`;
  const corr = (suffix: string) => `${ns}-${suffix}`;

  beforeAll(async () => {
    loadTestEnv();
    migrateTestDb();
    prisma = new PrismaService({ url: process.env.DATABASE_URL! });
    await prisma.onModuleInit();
    uow = new PrismaUnitOfWork(prisma);
    outbox = new OutboxRepository(prisma, store);
    audit = new AuditRepository(prisma, store);
  });
  afterAll(async () => {
    await prisma.businessOutbox.deleteMany({
      where: { correlationId: { startsWith: ns } },
    });
    await prisma.auditEvent.deleteMany({
      where: { correlationId: { startsWith: ns } },
    });
    await prisma.onModuleDestroy();
  });

  const event = {
    aggregateType: 'application',
    aggregateId: ns,
    eventType: 'StepCompleted',
    payload: { step: 'x' },
  };
  const inCtx = <T>(id: string, fn: () => Promise<T>) =>
    store.run({ correlationId: id, requestId: 'r' }, fn);

  it('commits outbox and audit rows written in the same transaction', async () => {
    await inCtx(corr('commit'), () =>
      uow.run(async (tx) => {
        await outbox.add(event, tx);
        await audit.append(
          {
            actorType: 'SYSTEM',
            action: 'test',
            aggregateType: 'application',
            aggregateId: ns,
          },
          tx,
        );
      }),
    );
    const rows = (await outbox.claimBatch(500)).filter(
      (r) => r.correlationId === corr('commit'),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      aggregateId: ns,
      eventType: 'StepCompleted',
      payload: { step: 'x' },
      attempts: 0,
    });
    expect(
      await prisma.auditEvent.count({
        where: { correlationId: corr('commit') },
      }),
    ).toBe(1);
  });

  it('rolls back everything, including the outbox row, when the function throws', async () => {
    await expect(
      inCtx(corr('rollback'), () =>
        uow.run(async (tx) => {
          await outbox.add(event, tx);
          await audit.append(
            {
              actorType: 'SYSTEM',
              action: 'test',
              aggregateType: 'application',
              aggregateId: ns,
            },
            tx,
          );
          throw new Error('boom');
        }),
      ),
    ).rejects.toThrow('boom');
    expect(
      await prisma.businessOutbox.count({
        where: { correlationId: corr('rollback') },
      }),
    ).toBe(0);
    expect(
      await prisma.auditEvent.count({
        where: { correlationId: corr('rollback') },
      }),
    ).toBe(0);
  });

  it('supports nested run by reusing the outer transaction', async () => {
    await inCtx(corr('nested'), () =>
      uow.run(async (tx) => {
        await uow.run(async (inner) => {
          expect(inner).toBe(tx);
          await outbox.add(event, inner);
        });
      }),
    );
    expect(
      await prisma.businessOutbox.count({
        where: { correlationId: corr('nested') },
      }),
    ).toBe(1);
  });
});

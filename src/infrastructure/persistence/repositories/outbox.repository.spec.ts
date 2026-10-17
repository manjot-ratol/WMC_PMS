import { randomUUID } from 'node:crypto';
import { CorrelationStore } from '../../../common/correlation/correlation.store';
import {
  describeWithDb,
  loadTestEnv,
  migrateTestDb,
} from '../../../../test/support/db';
import { PrismaService } from '../prisma.service';
import { InboxRepository } from './inbox.repository';
import { OutboxRepository } from './outbox.repository';

describeWithDb('Outbox and Inbox repositories (docker postgres)', () => {
  let prisma: PrismaService;
  let outbox: OutboxRepository;
  let inbox: InboxRepository;
  const store = new CorrelationStore();
  const ns = `repo-${randomUUID()}`;

  beforeAll(async () => {
    loadTestEnv();
    migrateTestDb();
    prisma = new PrismaService({ url: process.env.DATABASE_URL! });
    await prisma.onModuleInit();
    outbox = new OutboxRepository(prisma, store);
    inbox = new InboxRepository(prisma, store);
  });
  afterAll(async () => {
    await prisma.businessOutbox.deleteMany({ where: { aggregateId: ns } });
    await prisma.integrationInbox.deleteMany({
      where: { eventKey: { startsWith: ns } },
    });
    await prisma.onModuleDestroy();
  });

  it('claims undispatched rows oldest first, then marks dispatched or failed', async () => {
    const a = await outbox.add({
      aggregateType: 't',
      aggregateId: ns,
      eventType: 'A',
      payload: {},
    });
    const b = await outbox.add({
      aggregateType: 't',
      aggregateId: ns,
      eventType: 'B',
      payload: {},
    });
    const mine = (rows: { id: string; aggregateId: string }[]) =>
      rows.filter((r) => r.aggregateId === ns).map((r) => r.id);
    const batch = await outbox.claimBatch(500);
    expect(mine(batch)).toEqual([a, b]);
    expect(batch.find((r) => r.id === a)?.correlationId).toBe('none');
    await outbox.markDispatched(a);
    await outbox.markFailed(b, 'no route');
    const again = await outbox.claimBatch(500);
    expect(mine(again)).toEqual([b]);
    expect(again.find((r) => r.id === b)?.attempts).toBe(1);
  });

  it('records the ambient correlation id', async () => {
    const id = await store.run(
      { correlationId: `${ns}-corr`, requestId: 'r' },
      () =>
        outbox.add({
          aggregateType: 't',
          aggregateId: ns,
          eventType: 'C',
          payload: { k: 1 },
        }),
    );
    const row = await prisma.businessOutbox.findUniqueOrThrow({
      where: { id },
    });
    expect(row.correlationId).toBe(`${ns}-corr`);
  });

  it('inbox insertIfNew is idempotent per provider+eventKey', async () => {
    const key = `${ns}-evt-1`;
    const first = await inbox.insertIfNew('digio', key, { x: 1 });
    const dup = await inbox.insertIfNew('digio', key, { x: 2 });
    const other = await inbox.insertIfNew('trackwizz', key, {});
    expect(first.inserted).toBe(true);
    expect(dup).toEqual({ inserted: false, id: first.id });
    expect(other.inserted).toBe(true);
    await inbox.markProcessed(first.id);
    await inbox.markFailed(other.id, 'bad');
    const rows = await prisma.integrationInbox.findMany({
      where: { eventKey: key },
      orderBy: { provider: 'asc' },
    });
    expect(rows.map((r) => r.status)).toEqual(['PROCESSED', 'FAILED']);
    expect(rows[0].processedAt).not.toBeNull();
  });
});

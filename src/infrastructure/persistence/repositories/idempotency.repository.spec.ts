import { randomUUID } from 'node:crypto';
import {
  describeWithDb,
  loadTestEnv,
  migrateTestDb,
} from '../../../../test/support/db';
import { CorrelationStore } from '../../../common/correlation/correlation.store';
import { PrismaService } from '../prisma.service';
import { AuditRepository } from './audit.repository';
import { IdempotencyRepository } from './idempotency.repository';

describeWithDb('Idempotency and Audit repositories (docker postgres)', () => {
  let prisma: PrismaService;
  let repo: IdempotencyRepository;
  const principal = `idem-${randomUUID()}`;

  beforeAll(async () => {
    loadTestEnv();
    migrateTestDb();
    prisma = new PrismaService({ url: process.env.DATABASE_URL! });
    await prisma.onModuleInit();
    repo = new IdempotencyRepository(prisma);
  });
  afterAll(async () => {
    await prisma.idempotencyRecord.deleteMany({
      where: { principalId: principal },
    });
    await prisma.onModuleDestroy();
  });

  it('saves and finds a record, ignoring expired ones and other principals', async () => {
    const future = new Date(Date.now() + 60_000);
    await repo.save({
      principalId: principal,
      route: 'POST /x',
      key: 'k',
      requestHash: 'h',
      statusCode: 201,
      responseBody: { ok: 1 },
      expiresAt: future,
    });
    expect(await repo.find(principal, 'POST /x', 'k')).toMatchObject({
      statusCode: 201,
      responseBody: { ok: 1 },
      requestHash: 'h',
    });
    await repo.save({
      principalId: principal,
      route: 'POST /x',
      key: 'old',
      requestHash: 'h',
      statusCode: 200,
      responseBody: {},
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await repo.find(principal, 'POST /x', 'old')).toBeNull();
    expect(await repo.find(`${principal}-other`, 'POST /x', 'k')).toBeNull();
  });

  it('save is an upsert on the composite key', async () => {
    const future = new Date(Date.now() + 60_000);
    await repo.save({
      principalId: principal,
      route: 'r',
      key: 'k',
      requestHash: 'h',
      statusCode: 200,
      responseBody: { v: 1 },
      expiresAt: future,
    });
    await repo.save({
      principalId: principal,
      route: 'r',
      key: 'k',
      requestHash: 'h',
      statusCode: 200,
      responseBody: { v: 2 },
      expiresAt: future,
    });
    expect((await repo.find(principal, 'r', 'k'))?.responseBody).toEqual({
      v: 2,
    });
  });

  it('audit repository exposes only append', () => {
    const audit = new AuditRepository(prisma, new CorrelationStore());
    const methods = Object.getOwnPropertyNames(
      Object.getPrototypeOf(audit) as object,
    ).filter((m) => m !== 'constructor');
    expect(methods).toEqual(['append']);
  });
});

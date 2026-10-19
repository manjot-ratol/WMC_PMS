import { randomUUID } from 'node:crypto';
import { FieldCipher } from '../../../common/crypto/field-cipher';
import {
  describeWithDb,
  loadTestEnv,
  migrateTestDb,
} from '../../../../test/support/db';
import type { PortfolioImport } from '../../../domain/portfolio/portfolio-import';
import { PrismaService } from '../prisma.service';
import { PortfolioRepository } from './portfolio.repository';

describeWithDb('Phase 9 repositories (docker postgres)', () => {
  let prisma: PrismaService;
  let repo: PortfolioRepository;
  const ns = randomUUID().slice(0, 8);
  const app = `app_${ns}`;
  const now = new Date('2026-10-19T00:00:00Z');

  beforeAll(async () => {
    loadTestEnv();
    migrateTestDb();
    prisma = new PrismaService({ url: process.env.DATABASE_URL! });
    await prisma.onModuleInit();
    repo = new PortfolioRepository(
      prisma,
      new FieldCipher({
        fieldKeyId: 'k1',
        fieldKeyBase64: process.env.FIELD_ENCRYPTION_KEY!,
      }),
    );
  });
  afterAll(async () => {
    await prisma.portfolioSnapshot.deleteMany({
      where: { applicationId: app },
    });
    await prisma.portfolioImport.deleteMany({ where: { applicationId: app } });
    await prisma.onModuleDestroy();
  });

  it('imports: create, lookups by id / client ref / latest, update', async () => {
    const imp: PortfolioImport = {
      id: `pi_${ns}`,
      applicationId: app,
      provider: 'MFCENTRAL',
      status: 'AWAITING_AUTHORISATION',
      clientRefNo: `pi${ns}`,
      providerRequestId: `req${ns}`,
      authorisationUrl: 'http://mock/investor?reqId=1',
      expiresAt: new Date(now.getTime() + 900_000),
      createdAt: now,
      updatedAt: now,
    };
    await repo.createImport(imp);
    expect(await repo.findImport(imp.id)).toMatchObject({
      status: 'AWAITING_AUTHORISATION',
      failureCategory: undefined,
      completedAt: undefined,
    });
    expect((await repo.findImportByClientRef(`pi${ns}`))?.id).toBe(imp.id);
    expect((await repo.findImportByProviderRequestId(`req${ns}`))?.id).toBe(
      imp.id,
    );
    expect(await repo.findImportByProviderRequestId('nope')).toBeNull();
    expect((await repo.latestImport(app))?.id).toBe(imp.id);
    expect(await repo.findImport('pi_nope')).toBeNull();
    expect(await repo.findImportByClientRef('nope')).toBeNull();
    await repo.updateImport({
      ...imp,
      status: 'FAILED',
      failureCategory: 'provider_rejected',
      lastError: 'Failed to Validate QR code',
      completedAt: now,
    });
    expect(await repo.findImport(imp.id)).toMatchObject({
      status: 'FAILED',
      failureCategory: 'provider_rejected',
      lastError: 'Failed to Validate QR code',
      completedAt: now,
    });
    const later: PortfolioImport = {
      ...imp,
      id: `pi_${ns}b`,
      clientRefNo: `pi${ns}b`,
      createdAt: new Date(now.getTime() + 1000),
    };
    await repo.createImport(later);
    expect((await repo.latestImport(app))?.id).toBe(later.id);
    const minimal: PortfolioImport = {
      id: `pi_${ns}c`,
      applicationId: app,
      provider: 'MFCENTRAL',
      status: 'SKIPPED',
      clientRefNo: `pi${ns}c`,
      expiresAt: now,
      createdAt: new Date(now.getTime() + 2000),
      updatedAt: now,
    };
    await repo.createImport(minimal);
    expect(await repo.findImport(minimal.id)).toMatchObject({
      status: 'SKIPPED',
      providerRequestId: undefined,
      authorisationUrl: undefined,
      failureCategory: undefined,
      lastError: undefined,
      completedAt: undefined,
    });
  });

  it('snapshots: encrypted at rest, insert-if-new per import, latest by application', async () => {
    const data = {
      source: 'MFCENTRAL' as const,
      asOf: '2026-10-18',
      investor: { name: 'V', panMasked: 'AB••••••4J' },
      totals: { marketValueInr: 10, folioCount: 1, schemeCount: 1 },
      byAssetClass: [
        { assetClass: 'EQUITY' as const, marketValueInr: 10, weightPct: 100 },
      ],
      holdings: [
        {
          amc: 'A',
          schemeName: 'S',
          folioMasked: '••••1234',
          assetClass: 'EQUITY' as const,
          units: 1,
          nav: 10,
          marketValueInr: 10,
        },
      ],
    };
    const snap = {
      id: `ps_${ns}`,
      importId: `pi_${ns}`,
      applicationId: app,
      data,
      evidenceKey: `portfolio/${app}/pi_${ns}/cas.json`,
      createdAt: now,
    };
    expect(await repo.createSnapshot(snap)).toBe(true);
    expect(await repo.createSnapshot({ ...snap, id: `ps_${ns}dup` })).toBe(
      false,
    );
    const raw = await prisma.portfolioSnapshot.findUnique({
      where: { id: snap.id },
    });
    expect(Buffer.from(raw!.data).toString('utf8')).not.toContain('1234');
    expect(await repo.latestSnapshot(app)).toMatchObject({ id: snap.id, data });
    expect(await repo.latestSnapshot('app_nope')).toBeNull();
  });
});

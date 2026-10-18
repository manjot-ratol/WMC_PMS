import { randomUUID } from 'node:crypto';
import {
  describeWithDb,
  loadTestEnv,
  migrateTestDb,
} from '../../../../test/support/db';
import { PrismaService } from '../prisma.service';
import { ComplianceRepository } from './compliance.repository';

describeWithDb('Phase 7 compliance repository (docker postgres)', () => {
  let prisma: PrismaService;
  let repo: ComplianceRepository;
  const ns = randomUUID().slice(0, 8);
  const app = `app_${ns}`;
  const now = new Date('2026-10-18T00:00:00Z');

  beforeAll(async () => {
    loadTestEnv();
    migrateTestDb();
    prisma = new PrismaService({ url: process.env.DATABASE_URL! });
    await prisma.onModuleInit();
    repo = new ComplianceRepository(prisma);
  });
  afterAll(async () => {
    for (const t of [
      'reviewDecision',
      'complianceCase',
      'screeningRun',
      'amlAssessment',
    ] as const) {
      await (
        prisma[t] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }
      ).deleteMany({ where: { applicationId: app } });
    }
    await prisma.onModuleDestroy();
  });

  it('runs can be found and updated with outcomes; supersession can target one kind', async () => {
    await repo.createScreeningRun({
      id: `sr_${ns}`,
      applicationId: app,
      identityVersion: 1,
      screeningPolicyVersion: 'screening_v1',
      status: 'QUEUED',
      createdAt: now,
    });
    await repo.createAmlAssessment({
      id: `aml_${ns}`,
      applicationId: app,
      identityVersion: 1,
      profileVersion: 1,
      declarationVersion: 1,
      policyVersion: 'aml_v1',
      status: 'QUEUED',
      createdAt: now,
    });
    await repo.supersedeOpen(app, undefined, 'AML');
    expect((await repo.findScreeningRun(`sr_${ns}`))?.status).toBe('QUEUED');
    expect((await repo.findAmlAssessment(`aml_${ns}`))?.status).toBe(
      'SUPERSEDED',
    );
    await repo.updateScreeningRun({
      id: `sr_${ns}`,
      applicationId: app,
      identityVersion: 1,
      screeningPolicyVersion: 'screening_v1',
      status: 'REVIEW',
      suggestedAction: 'Review',
      hitsCount: 2,
      confirmedHit: false,
      providerRequestId: `sr_${ns}`,
      evidenceKey: 'e',
      completedAt: now,
      createdAt: now,
    });
    expect(await repo.findScreeningRun(`sr_${ns}`)).toMatchObject({
      status: 'REVIEW',
      hitsCount: 2,
      confirmedHit: false,
      evidenceKey: 'e',
      completedAt: now,
    });
    await repo.updateAmlAssessment({
      id: `aml_${ns}`,
      applicationId: app,
      identityVersion: 1,
      profileVersion: 1,
      declarationVersion: 1,
      policyVersion: 'aml_v1',
      status: 'PROCEED',
      riskValue: 'Low',
      nextReviewDate: new Date('2027-03-21'),
      completedAt: now,
      createdAt: now,
    });
    expect(await repo.findAmlAssessment(`aml_${ns}`)).toMatchObject({
      status: 'PROCEED',
      riskValue: 'Low',
    });
    expect(await repo.findScreeningRun('sr_nope')).toBeNull();
    expect(await repo.findAmlAssessment('aml_nope')).toBeNull();
  });

  it('cases and decisions', async () => {
    const c = {
      id: `case_${ns}`,
      applicationId: app,
      kind: 'SCREENING_HIT' as const,
      sourceRunId: `sr_${ns}`,
      severity: 'MEDIUM' as const,
      status: 'OPEN' as const,
      providerCaseId: 'C1',
      providerCaseUrl: 'https://tw/C1',
      summary: { hitsCount: 2 },
      createdAt: now,
    };
    await repo.createCase(c);
    expect(await repo.findCase(c.id)).toMatchObject({
      kind: 'SCREENING_HIT',
      providerCaseId: 'C1',
      summary: { hitsCount: 2 },
    });
    expect((await repo.listOpenCases(app)).map((x) => x.id)).toEqual([c.id]);
    await repo.createDecision({
      id: `rd_${ns}`,
      caseId: c.id,
      applicationId: app,
      reviewerId: 'rev-1',
      decision: 'PROCEED',
      reason: 'false positive',
      createdAt: now,
    });
    await repo.updateCase({
      ...c,
      status: 'CLOSED',
      closedAt: now,
      summary: { hitsCount: 2, decision: 'PROCEED' },
    });
    expect(await repo.listOpenCases(app)).toEqual([]);
    expect(await repo.findCase(c.id)).toMatchObject({
      status: 'CLOSED',
      summary: { decision: 'PROCEED' },
    });
    expect(await repo.findCase('case_nope')).toBeNull();
  });
});

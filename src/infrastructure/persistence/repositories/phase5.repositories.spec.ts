import { randomUUID } from 'node:crypto';
import { FieldCipher } from '../../../common/crypto/field-cipher';
import {
  describeWithDb,
  loadTestEnv,
  migrateTestDb,
} from '../../../../test/support/db';
import { PrismaService } from '../prisma.service';
import { FeeRepository } from './fee.repository';
import { ReviewRepository } from './review.repository';
import { SuitabilityRepository } from './suitability.repository';

describeWithDb('Phase 5 repositories (docker postgres)', () => {
  let prisma: PrismaService;
  let suitability: SuitabilityRepository;
  let fees: FeeRepository;
  let reviews: ReviewRepository;
  const ns = randomUUID().slice(0, 8);
  const app = `app_${ns}`;
  const now = new Date('2026-10-18T00:00:00Z');

  beforeAll(async () => {
    loadTestEnv();
    migrateTestDb();
    prisma = new PrismaService({ url: process.env.DATABASE_URL! });
    await prisma.onModuleInit();
    const cipher = new FieldCipher({
      fieldKeyId: 'k1',
      fieldKeyBase64: process.env.FIELD_ENCRYPTION_KEY!,
    });
    suitability = new SuitabilityRepository(prisma);
    fees = new FeeRepository(prisma, cipher);
    reviews = new ReviewRepository(prisma);
  });
  afterAll(async () => {
    for (const t of [
      'suitabilityAssessment',
      'investmentApproach',
      'feeIllustration',
      'acknowledgement',
      'reviewSnapshot',
    ] as const) {
      await (
        prisma[t] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }
      ).deleteMany({ where: { applicationId: app } });
    }
    await prisma.onModuleDestroy();
  });

  it('assessments and approaches: versioned, latest wins, lookup by id', async () => {
    await suitability.appendAssessment({
      id: `sa_${ns}_1`,
      applicationId: app,
      version: 1,
      questionnaireVersion: 'suitability_v1',
      answers: [{ questionId: 'OBJECTIVE', answerId: 'LONG_TERM_GROWTH' }],
      status: 'INCOMPLETE',
      missingQuestionIds: ['HORIZON'],
      permittedApproachCodes: [],
      createdAt: now,
    });
    await suitability.appendAssessment({
      id: `sa_${ns}_2`,
      applicationId: app,
      version: 2,
      questionnaireVersion: 'suitability_v1',
      answers: [],
      status: 'COMPLETE',
      score: 18,
      riskProfile: 'AGGRESSIVE',
      missingQuestionIds: [],
      permittedApproachCodes: ['EQUITY_GROWTH'],
      createdAt: now,
    });
    expect(await suitability.latestAssessment(app)).toMatchObject({
      id: `sa_${ns}_2`,
      version: 2,
      score: 18,
      riskProfile: 'AGGRESSIVE',
      permittedApproachCodes: ['EQUITY_GROWTH'],
    });
    expect(await suitability.findAssessment(`sa_${ns}_1`)).toMatchObject({
      status: 'INCOMPLETE',
      score: undefined,
      missingQuestionIds: ['HORIZON'],
    });
    expect(await suitability.findAssessment('sa_nope')).toBeNull();
    expect(await suitability.latestApproach(app)).toBeNull();
    await suitability.appendApproach({
      applicationId: app,
      version: 1,
      assessmentId: `sa_${ns}_2`,
      assessmentVersion: 2,
      approachCode: 'EQUITY_GROWTH',
      confirmedAt: now,
    });
    expect(await suitability.latestApproach(app)).toMatchObject({
      version: 1,
      approachCode: 'EQUITY_GROWTH',
      assessmentVersion: 2,
    });
  });

  it('fee illustrations persist; acknowledgements keep the note encrypted', async () => {
    await fees.createIllustration({
      id: `fi_${ns}`,
      applicationId: app,
      approachCode: 'EQUITY_GROWTH',
      scenarioCode: 'RETURN_FLAT',
      feeScheduleVersion: 'fees_v1',
      disclaimerVersion: 'illustration_v1',
      assumptions: {
        investmentInr: 5_000_000,
        assumedReturnBps: 0,
        periodYears: 1,
      },
      lineItems: [{ code: 'GROSS_RETURN', amountInr: 0 }],
      createdAt: now,
    });
    expect(
      await prisma.feeIllustration.count({ where: { applicationId: app } }),
    ).toBe(1);
    const note = `my own words ${ns} about fees`;
    await fees.appendAcknowledgement({
      applicationId: app,
      version: 1,
      documentPackVersion: 1,
      items: [{ documentType: 'DISCLOSURE', documentVersion: 'disclosure_v1' }],
      feeUnderstandingNote: note,
      feeAnnexureExecutionRequired: true,
      recordedAt: now,
    });
    expect(await fees.latestAcknowledgement(app)).toMatchObject({
      version: 1,
      feeUnderstandingNote: note,
      feeAnnexureExecutionRequired: true,
    });
    const raw = await prisma.acknowledgement.findFirstOrThrow({
      where: { applicationId: app },
    });
    expect(
      Buffer.from(raw.feeUnderstandingNote).toString('utf8'),
    ).not.toContain(ns);
  });

  it('review snapshots: current lookup and supersession', async () => {
    const sections = {
      identity: {
        version: 1,
        legalName: 'V',
        panMasked: 'AB••••••4F',
        dateOfBirth: '1990-01-01',
      },
    } as never;
    await reviews.create({
      id: `snap_${ns}_1`,
      applicationId: app,
      confirmedApplicationVersion: 11,
      applicationVersion: 12,
      documentPackVersion: 1,
      sections,
      hash: 'a'.repeat(64),
      status: 'CURRENT',
      confirmedAt: now,
    });
    expect(await reviews.current(app)).toMatchObject({
      id: `snap_${ns}_1`,
      applicationVersion: 12,
    });
    await reviews.supersedeCurrent(app);
    expect(await reviews.current(app)).toBeNull();
    expect(await reviews.findById(`snap_${ns}_1`)).toMatchObject({
      status: 'SUPERSEDED',
      sections,
    });
    await reviews.create({
      id: `snap_${ns}_2`,
      applicationId: app,
      confirmedApplicationVersion: 13,
      applicationVersion: 14,
      documentPackVersion: 1,
      sections,
      hash: 'b'.repeat(64),
      status: 'CURRENT',
      confirmedAt: new Date(now.getTime() + 1000),
    });
    expect((await reviews.current(app))?.id).toBe(`snap_${ns}_2`);
  });
});

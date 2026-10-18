import {
  FakeAnalytics,
  FakeApplications,
  FakeAudit,
  FakeBank,
  FakeDeclarations,
  FakeEligibility,
  FakeFees,
  FakeIdentities,
  FakeKycRecords,
  FakeNominations,
  FakeOutbox,
  FakeProfiles,
  FakeReviews,
  FakeSuitability,
  FakeTasks,
  FakeUow,
  FixedClock,
  SeqIds,
} from '../../../test/support/fakes';
import {
  NotFoundError,
  StaleVersionError,
  ValidationError,
} from '../../common/errors/app-error';
import { loadDocumentPackRulebook } from '../../domain/documents/document-pack';
import { loadFeeRulebook } from '../../domain/fees/fee-engine';
import {
  completeStep,
  newApplication,
} from '../../domain/onboarding/application';
import { toIsoDate } from '../../domain/shared/iso-date';
import { loadSuitabilityRulebook } from '../../domain/suitability/suitability';
import { FeesService } from '../fees/fees.service';
import { ReviewService } from '../review/review.service';
import { SuitabilityService } from './suitability.service';

function build(
  packOverride?: Partial<ReturnType<typeof loadDocumentPackRulebook>>,
) {
  const clock = new FixedClock();
  const now = clock.now();
  const d = {
    uow: new FakeUow(),
    applications: new FakeApplications(),
    eligibility: new FakeEligibility(),
    identities: new FakeIdentities((p) => p),
    kyc: new FakeKycRecords(),
    profiles: new FakeProfiles(),
    declarations: new FakeDeclarations(),
    bank: new FakeBank((a) => a),
    nominations: new FakeNominations(),
    suitability: new FakeSuitability(),
    fees: new FakeFees(),
    reviews: new FakeReviews(),
    tasks: new FakeTasks(),
    audit: new FakeAudit(),
    outbox: new FakeOutbox(),
    analytics: new FakeAnalytics(),
    clock,
    ids: new SeqIds(),
  };
  let app = newApplication('app_1', 'cus_1', now);
  for (const [step, screen] of [
    ['EMAIL_VERIFIED', 'ELIGIBILITY'],
    ['ELIGIBILITY', 'PAN_IDENTITY'],
    ['IDENTITY', 'KYC_PROGRESS'],
    ['KYC', 'IPV'],
    ['IPV', 'PROFILE'],
    ['PROFILE', 'TAX_DECLARATIONS'],
    ['DECLARATIONS', 'BANK_DETAILS'],
    ['BANK', 'NOMINATION'],
    ['NOMINATION', 'INVESTMENT_PROFILE'],
  ] as const)
    app = completeStep(app, step, screen, now);
  void d.applications.create(app);
  void d.eligibility.append({
    id: 'e1',
    applicationId: 'app_1',
    version: 1,
    input: {
      customerType: 'INDIVIDUAL',
      residentialStatus: 'RESIDENT',
      intendedInvestmentInr: 5_000_000,
      distributionRoute: 'DIRECT',
    },
    status: 'ELIGIBLE',
    rulesetVersion: 'v1',
    journeyRoute: 'RESIDENT_SINGLE_HOLDER',
    reasons: [],
    nextScreen: 'PAN_IDENTITY',
    decidedAt: now,
  });
  void d.identities.append({
    applicationId: 'app_1',
    version: 1,
    pan: 'ABCPE1234F',
    legalName: 'Vinod Kumar Singh',
    dateOfBirth: toIsoDate('1990-01-15'),
    permissionVersion: 'v',
    status: 'SUBMITTED',
    submittedAt: now,
  });
  void d.kyc.create({
    id: 'kyc_1',
    applicationId: 'app_1',
    identityVersion: 1,
    provider: 'DIGIO_KRA',
    status: 'COMPLETE',
    route: 'REUSE',
    operationId: 'op_1',
    version: 2,
    updatedAt: now,
  });
  void d.profiles.append({
    applicationId: 'app_1',
    version: 1,
    occupation: 'PRIVATE_SECTOR',
    annualIncomeBand: 'INR_10L_25L',
    sourceOfFunds: ['SALARY'],
    evidenceRequired: false,
    savedAt: now,
  });
  void d.declarations.append({
    applicationId: 'app_1',
    version: 1,
    taxResidencies: [{ country: 'IN', tin: 'ABCPE1234F' }],
    pepDeclaration: 'NOT_PEP',
    declarationVersion: 'declarations_v1',
    additionalInformationRequired: false,
    attestedAt: now,
  });
  void d.bank.createAccount({
    id: 'ba_1',
    applicationId: 'app_1',
    accountNumber: '999912345678',
    ifsc: 'HDFC0001234',
    holderName: 'Vinod Kumar Singh',
    version: 1,
    createdAt: now,
  });
  void d.bank.createVerification({
    id: 'bv_1',
    applicationId: 'app_1',
    bankAccountId: 'ba_1',
    status: 'VERIFIED',
    requiredActions: [],
    createdAt: now,
    updatedAt: now,
  });
  void d.nominations.append({
    applicationId: 'app_1',
    version: 1,
    choice: 'NOMINATE',
    allocationMode: 'EQUAL',
    nominees: [
      {
        fullName: 'Asha Singh',
        relationship: 'SPOUSE',
        isMinor: false,
        allocationPercent: 100,
      },
    ],
    registrationStatus: 'NOT_SUBMITTED',
    savedAt: now,
  });
  const pack = { ...loadDocumentPackRulebook(), ...packOverride };
  const suitability = new SuitabilityService(
    d.uow,
    d.applications,
    d.suitability,
    d.audit,
    d.outbox,
    d.analytics,
    d.clock,
    d.ids,
    loadSuitabilityRulebook(),
  );
  const fees = new FeesService(
    d.uow,
    d.applications,
    d.suitability,
    d.fees,
    d.audit,
    d.outbox,
    d.analytics,
    d.clock,
    d.ids,
    loadFeeRulebook(),
    pack,
  );
  const review = new ReviewService(
    d.uow,
    d.applications,
    d.eligibility,
    d.identities,
    d.kyc,
    d.profiles,
    d.declarations,
    d.bank,
    d.nominations,
    d.suitability,
    d.fees,
    d.reviews,
    d.tasks,
    d.audit,
    d.outbox,
    d.analytics,
    d.clock,
    d.ids,
    pack,
  );
  return { d, suitability, fees, review };
}
const answers = (o: Record<string, string> = {}) =>
  Object.entries({
    OBJECTIVE: 'LONG_TERM_GROWTH',
    HORIZON: 'FIVE_YEARS_PLUS',
    LIQUIDITY: 'NONE_EXPECTED',
    EXPERIENCE: 'DIRECT_EQUITY',
    RISK_CAPACITY: 'LOSS_UP_TO_25',
    ...o,
  }).map(([questionId, answerId]) => ({ questionId, answerId }));
const base = { applicationId: 'app_1', customerId: 'cus_1' };
const ackCmd = {
  ...base,
  documentPackVersion: 1,
  acknowledgements: [
    {
      documentType: 'DISCLOSURE',
      documentVersion: 'disclosure_v1',
      acknowledged: true,
    },
    { documentType: 'MITC', documentVersion: 'mitc_v1', acknowledged: true },
  ],
  feeUnderstandingNote:
    'I understand the fees are charged on my portfolio every year.',
};

async function toReview(b: ReturnType<typeof build>) {
  const a = await b.suitability.assess({
    ...base,
    questionnaireVersion: 'suitability_v1',
    answers: answers(),
  });
  await b.suitability.confirmApproach({
    ...base,
    assessmentId: a.assessmentId,
    assessmentVersion: 1,
    approachCode: 'EQUITY_GROWTH',
    confirmed: true,
  });
  await b.fees.acknowledge(ackCmd);
  return a;
}

describe('SuitabilityService', () => {
  it('persists an incomplete questionnaire without advancing, then a complete one advances to the approach screen', async () => {
    const { d, suitability } = build();
    const partial = await suitability.assess({
      ...base,
      questionnaireVersion: 'suitability_v1',
      answers: answers().slice(0, 2),
    });
    expect(partial).toMatchObject({
      status: 'INCOMPLETE',
      missingQuestionIds: ['LIQUIDITY', 'EXPERIENCE', 'RISK_CAPACITY'],
      nextScreen: 'INVESTMENT_PROFILE',
    });
    expect(d.applications.rows.get('app_1')?.nextScreen).toBe(
      'INVESTMENT_PROFILE',
    );
    const full = await suitability.assess({
      ...base,
      questionnaireVersion: 'suitability_v1',
      answers: answers(),
    });
    expect(full).toMatchObject({
      status: 'COMPLETE',
      missingQuestionIds: [],
      nextScreen: 'INVESTMENT_APPROACH',
    });
    expect(d.suitability.assessments.map((a) => a.version)).toEqual([1, 2]);
    expect(d.applications.rows.get('app_1')?.nextScreen).toBe(
      'INVESTMENT_APPROACH',
    );
    expect(JSON.stringify(d.analytics.events)).not.toMatch(
      /LONG_TERM_GROWTH|AGGRESSIVE|18/,
    );
  });
  it('contradictory answers are rejected with nothing persisted; stale questionnaire is 409; nomination is required first', async () => {
    const { d, suitability } = build();
    await expect(
      suitability.assess({
        ...base,
        questionnaireVersion: 'suitability_v1',
        answers: answers({ HORIZON: 'UNDER_1_YEAR' }),
      }),
    ).rejects.toMatchObject({
      details: {
        reason: 'contradictory_answers',
        questionIds: ['OBJECTIVE', 'HORIZON'],
      },
    });
    expect(d.suitability.assessments).toHaveLength(0);
    await expect(
      suitability.assess({
        ...base,
        questionnaireVersion: 'suitability_v0',
        answers: answers(),
      }),
    ).rejects.toBeInstanceOf(StaleVersionError);
    await d.applications.create(newApplication('app_2', 'cus_1', new Date()));
    await expect(
      suitability.assess({
        ...base,
        applicationId: 'app_2',
        questionnaireVersion: 'suitability_v1',
        answers: answers(),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      suitability.assess({
        ...base,
        customerId: 'cus_x',
        questionnaireVersion: 'suitability_v1',
        answers: answers(),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
  it('approach: only the latest complete assessment, only permitted codes, only with explicit confirmation', async () => {
    const { d, suitability } = build();
    await expect(
      suitability.confirmApproach({
        ...base,
        assessmentId: 'sa_x',
        assessmentVersion: 1,
        approachCode: 'EQUITY_GROWTH',
        confirmed: true,
      }),
    ).rejects.toBeInstanceOf(ValidationError); // SUITABILITY step missing
    const a = await suitability.assess({
      ...base,
      questionnaireVersion: 'suitability_v1',
      answers: answers(),
    });
    await expect(
      suitability.confirmApproach({
        ...base,
        assessmentId: a.assessmentId,
        assessmentVersion: 2,
        approachCode: 'EQUITY_GROWTH',
        confirmed: true,
      }),
    ).rejects.toBeInstanceOf(StaleVersionError);
    await expect(
      suitability.confirmApproach({
        ...base,
        assessmentId: 'sa_other',
        assessmentVersion: 1,
        approachCode: 'EQUITY_GROWTH',
        confirmed: true,
      }),
    ).rejects.toBeInstanceOf(StaleVersionError);
    await expect(
      suitability.confirmApproach({
        ...base,
        assessmentId: a.assessmentId,
        assessmentVersion: 1,
        approachCode: 'EQUITY_GROWTH',
        confirmed: false,
      }),
    ).rejects.toMatchObject({ details: { reason: 'confirmation_required' } });
    await expect(
      suitability.confirmApproach({
        ...base,
        assessmentId: a.assessmentId,
        assessmentVersion: 1,
        approachCode: 'CONSERVATIVE_INCOME',
        confirmed: true,
      }),
    ).rejects.toMatchObject({ details: { reason: 'approach_not_permitted' } });
    expect(d.suitability.approaches).toHaveLength(0);
    const r = await suitability.confirmApproach({
      ...base,
      assessmentId: a.assessmentId,
      assessmentVersion: 1,
      approachCode: 'EQUITY_GROWTH',
      confirmed: true,
    });
    expect(r).toEqual({
      status: 'CONFIRMED',
      approachVersion: 1,
      nextScreen: 'FEES_DISCLOSURES',
    });
    expect(d.applications.rows.get('app_1')?.nextScreen).toBe(
      'FEES_DISCLOSURES',
    );
    expect(JSON.stringify(d.analytics.events)).not.toContain('EQUITY_GROWTH');
  });
});

describe('FeesService', () => {
  it('illustrates only the confirmed approach under the current schedule and persists the result', async () => {
    const b = build();
    await expect(
      b.fees.illustrate({
        ...base,
        approachCode: 'EQUITY_GROWTH',
        feeScheduleVersion: 'fees_v1',
        scenarioCode: 'RETURN_PLUS_10',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const a = await b.suitability.assess({
      ...base,
      questionnaireVersion: 'suitability_v1',
      answers: answers(),
    });
    await b.suitability.confirmApproach({
      ...base,
      assessmentId: a.assessmentId,
      assessmentVersion: 1,
      approachCode: 'EQUITY_GROWTH',
      confirmed: true,
    });
    const r = await b.fees.illustrate({
      ...base,
      approachCode: 'EQUITY_GROWTH',
      feeScheduleVersion: 'fees_v1',
      scenarioCode: 'RETURN_PLUS_10',
    });
    expect(r).toMatchObject({
      status: 'CALCULATED',
      disclaimerVersion: 'illustration_v1',
    });
    expect(r.lineItems.map((l) => l.code)).toEqual([
      'GROSS_RETURN',
      'MANAGEMENT_FEE',
      'PERFORMANCE_FEE',
      'OPERATING_EXPENSES',
      'TOTAL_FEES',
      'NET_RETURN',
    ]);
    expect(b.d.fees.illustrations).toHaveLength(1);
    await expect(
      b.fees.illustrate({
        ...base,
        approachCode: 'FOCUSED_EQUITY',
        feeScheduleVersion: 'fees_v1',
        scenarioCode: 'RETURN_PLUS_10',
      }),
    ).rejects.toMatchObject({ details: { reason: 'approach_mismatch' } });
    await expect(
      b.fees.illustrate({
        ...base,
        approachCode: 'EQUITY_GROWTH',
        feeScheduleVersion: 'fees_v1',
        scenarioCode: 'MOON',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      b.fees.illustrate({
        ...base,
        approachCode: 'EQUITY_GROWTH',
        feeScheduleVersion: 'fees_v0',
        scenarioCode: 'RETURN_PLUS_10',
      }),
    ).rejects.toBeInstanceOf(StaleVersionError);
    expect(b.d.fees.illustrations).toHaveLength(1);
  });
  it('records acknowledgements with the encrypted-note contract and advances; an old pack is 409 with nothing written', async () => {
    const b = build();
    const a = await b.suitability.assess({
      ...base,
      questionnaireVersion: 'suitability_v1',
      answers: answers(),
    });
    await expect(b.fees.acknowledge(ackCmd)).rejects.toBeInstanceOf(
      ValidationError,
    ); // approach not confirmed
    await b.suitability.confirmApproach({
      ...base,
      assessmentId: a.assessmentId,
      assessmentVersion: 1,
      approachCode: 'EQUITY_GROWTH',
      confirmed: true,
    });
    const r = await b.fees.acknowledge(ackCmd);
    expect(r).toEqual({
      status: 'RECORDED',
      feeAnnexureExecutionRequired: true,
      nextScreen: 'APPLICATION_REVIEW',
    });
    expect(b.d.fees.acknowledgements[0]).toMatchObject({
      version: 1,
      documentPackVersion: 1,
      feeUnderstandingNote: ackCmd.feeUnderstandingNote,
    });
    expect(
      JSON.stringify(b.d.analytics.events) + JSON.stringify(b.d.audit.events),
    ).not.toContain('charged on my portfolio');
    const moved = build({ packVersion: 2 });
    const a2 = await moved.suitability.assess({
      ...base,
      questionnaireVersion: 'suitability_v1',
      answers: answers(),
    });
    await moved.suitability.confirmApproach({
      ...base,
      assessmentId: a2.assessmentId,
      assessmentVersion: 1,
      approachCode: 'EQUITY_GROWTH',
      confirmed: true,
    });
    await expect(moved.fees.acknowledge(ackCmd)).rejects.toBeInstanceOf(
      StaleVersionError,
    );
    expect(moved.d.fees.acknowledgements).toHaveLength(0);
  });
});

describe('ReviewService', () => {
  it('summary masks identifiers and reports readiness; confirmation freezes a hashed snapshot and advances to signing', async () => {
    const b = build();
    await expect(b.review.get('app_1', 'cus_1')).rejects.toBeInstanceOf(
      ValidationError,
    );
    await toReview(b);
    const s = await b.review.get('app_1', 'cus_1');
    expect(s).toMatchObject({
      documentPackVersion: 1,
      ready: true,
      blockers: [],
    });
    expect(s.sections.identity).toEqual({
      version: 1,
      legalName: 'Vinod Kumar Singh',
      panMasked: 'AB••••••4F',
      dateOfBirth: '1990-01-15',
    });
    expect(s.sections.bank.accountMasked).toBe('••••5678');
    expect(JSON.stringify(s)).not.toMatch(/ABCPE1234F|999912345678/);
    expect(s.sections.declarations.taxResidencyCountries).toEqual(['IN']);
    const r = await b.review.confirm({
      ...base,
      applicationVersion: s.applicationVersion,
      documentPackVersion: 1,
      detailsConfirmed: true,
    });
    expect(r).toMatchObject({
      status: 'CONFIRMED',
      nextScreen: 'SIGN_DOCUMENTS',
    });
    const snap = b.d.reviews.snapshots[0];
    expect(snap).toMatchObject({
      id: r.snapshotId,
      status: 'CURRENT',
      confirmedApplicationVersion: s.applicationVersion,
      applicationVersion: s.applicationVersion + 1,
    });
    expect(snap.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(b.d.applications.rows.get('app_1')).toMatchObject({
      nextScreen: 'SIGN_DOCUMENTS',
      version: snap.applicationVersion,
    });
    expect(JSON.stringify(b.d.analytics.events)).not.toContain(snap.hash);
  });
  it('stale application version is 409; unconfirmed details and open customer-evidence tasks are 422', async () => {
    const b = build();
    await toReview(b);
    const v = (await b.review.get('app_1', 'cus_1')).applicationVersion;
    await expect(
      b.review.confirm({
        ...base,
        applicationVersion: v - 1,
        documentPackVersion: 1,
        detailsConfirmed: true,
      }),
    ).rejects.toBeInstanceOf(StaleVersionError);
    await expect(
      b.review.confirm({
        ...base,
        applicationVersion: v,
        documentPackVersion: 2,
        detailsConfirmed: true,
      }),
    ).rejects.toBeInstanceOf(StaleVersionError);
    await expect(
      b.review.confirm({
        ...base,
        applicationVersion: v,
        documentPackVersion: 1,
        detailsConfirmed: false,
      }),
    ).rejects.toMatchObject({ details: { reason: 'confirmation_required' } });
    await b.d.tasks.create({
      id: 't1',
      applicationId: 'app_1',
      category: 'SOURCE_OF_FUNDS_EVIDENCE',
      status: 'OPEN',
      createdAt: new Date(),
    });
    await b.d.tasks.create({
      id: 't2',
      applicationId: 'app_1',
      category: 'PEP_EDD',
      status: 'OPEN',
      createdAt: new Date(),
    });
    expect((await b.review.get('app_1', 'cus_1')).blockers).toEqual([
      'open_task_source_of_funds_evidence',
    ]);
    await expect(
      b.review.confirm({
        ...base,
        applicationVersion: v,
        documentPackVersion: 1,
        detailsConfirmed: true,
      }),
    ).rejects.toMatchObject({
      details: { reason: 'open_task_source_of_funds_evidence' },
    });
    expect(b.d.reviews.snapshots).toHaveLength(0);
  });
  it('a new assessment after the approach was confirmed requires re-confirmation; an edit after review supersedes the snapshot on reconfirmation', async () => {
    const b = build();
    const first = await toReview(b);
    await b.suitability.assess({
      ...base,
      questionnaireVersion: 'suitability_v1',
      answers: answers({ EXPERIENCE: 'MUTUAL_FUNDS' }),
    });
    const s = await b.review.get('app_1', 'cus_1');
    expect(s.blockers).toEqual(['approach_reconfirmation_required']);
    await expect(
      b.review.confirm({
        ...base,
        applicationVersion: s.applicationVersion,
        documentPackVersion: 1,
        detailsConfirmed: true,
      }),
    ).rejects.toMatchObject({
      details: { reason: 'approach_reconfirmation_required' },
    });
    await expect(
      b.suitability.confirmApproach({
        ...base,
        assessmentId: first.assessmentId,
        assessmentVersion: 1,
        approachCode: 'EQUITY_GROWTH',
        confirmed: true,
      }),
    ).rejects.toBeInstanceOf(StaleVersionError);
    const latest = (await b.d.suitability.latestAssessment('app_1'))!;
    await b.suitability.confirmApproach({
      ...base,
      assessmentId: latest.id,
      assessmentVersion: 2,
      approachCode: 'EQUITY_GROWTH',
      confirmed: true,
    });
    const v1 = (await b.review.get('app_1', 'cus_1')).applicationVersion;
    const c1 = await b.review.confirm({
      ...base,
      applicationVersion: v1,
      documentPackVersion: 1,
      detailsConfirmed: true,
    });
    // a later profile edit bumps the application version: the old confirmation can no longer be replayed
    const app = b.d.applications.rows.get('app_1')!;
    await b.d.applications.saveWithVersionCheck(
      { ...app, version: app.version + 1, nextScreen: 'TAX_DECLARATIONS' },
      app.version,
    );
    await expect(
      b.review.confirm({
        ...base,
        applicationVersion: v1,
        documentPackVersion: 1,
        detailsConfirmed: true,
      }),
    ).rejects.toBeInstanceOf(StaleVersionError);
    const v2 = (await b.review.get('app_1', 'cus_1')).applicationVersion;
    const c2 = await b.review.confirm({
      ...base,
      applicationVersion: v2,
      documentPackVersion: 1,
      detailsConfirmed: true,
    });
    expect(c2.snapshotId).not.toBe(c1.snapshotId);
    expect(b.d.reviews.snapshots.map((x) => x.status)).toEqual([
      'SUPERSEDED',
      'CURRENT',
    ]);
    expect((await b.d.reviews.current('app_1'))?.id).toBe(c2.snapshotId);
  });
  it('a missing section (bank not verified) is reported as a blocker rather than crashing', async () => {
    const b = build();
    await toReview(b);
    await b.d.bank.updateVerification({
      ...(await b.d.bank.findVerification('bv_1'))!,
      status: 'REVIEW_REQUIRED',
    });
    expect((await b.review.get('app_1', 'cus_1')).blockers).toEqual([
      'bank_not_verified',
    ]);
    const empty = build();
    await toReview(empty);
    empty.d.nominations.rows.length = 0;
    await expect(empty.review.get('app_1', 'cus_1')).rejects.toMatchObject({
      details: { reason: 'section_nomination_missing' },
    });
  });
});

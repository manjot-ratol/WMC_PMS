import {
  FakeAnalytics,
  FakeApplications,
  FakeAudit,
  FakeBank,
  FakeCompliance,
  FakeDeclarations,
  FakeEligibility,
  FakeIdentities,
  FakeNominations,
  FakeOutbox,
  FakeProfiles,
  FakeStorage,
  FakeTasks,
  FakeUow,
  FixedClock,
  SeqIds,
  silentLogger,
} from '../../../test/support/fakes';
import { CorrelationStore } from '../../common/correlation/correlation.store';
import { Fingerprint } from '../../common/crypto/fingerprint';
import {
  DependencyUnavailableError,
  NotFoundError,
  StaleVersionError,
  ValidationError,
} from '../../common/errors/app-error';
import { loadBankRulebook } from '../../domain/bank/bank-account';
import { loadNominationRulebook } from '../../domain/nomination/nomination';
import {
  completeStep,
  newApplication,
} from '../../domain/onboarding/application';
import { loadTaxRulebook } from '../../domain/profile/declarations';
import { loadProfileRulebook } from '../../domain/profile/profile';
import { toIsoDate } from '../../domain/shared/iso-date';
import { BankVerificationService } from '../bank/bank-verification.service';
import { BankVerificationProcessor } from '../jobs/bank-verification.processor';
import { NominationService } from '../nomination/nomination.service';
import { DeclarationsService } from './declarations.service';
import { ProfileService } from './profile.service';

function build() {
  const fingerprint = new Fingerprint({
    fingerprintKeyBase64: Buffer.alloc(32, 2).toString('base64'),
  });
  const clock = new FixedClock();
  const now = clock.now();
  const d = {
    uow: new FakeUow(),
    applications: new FakeApplications(),
    identities: new FakeIdentities((p) => p),
    eligibility: new FakeEligibility(),
    profiles: new FakeProfiles(),
    declarations: new FakeDeclarations(),
    compliance: new FakeCompliance(),
    tasks: new FakeTasks(),
    bank: new FakeBank((a) => fingerprint.of(a, 'account')),
    nominations: new FakeNominations(),
    storage: new FakeStorage(),
    audit: new FakeAudit(),
    outbox: new FakeOutbox(),
    analytics: new FakeAnalytics(),
    clock,
    ids: new SeqIds(),
    gateway: { verify: jest.fn() },
  };
  let app = newApplication('app_1', 'cus_1', now);
  for (const [step, screen] of [
    ['EMAIL_VERIFIED', 'ELIGIBILITY'],
    ['ELIGIBILITY', 'PAN_IDENTITY'],
    ['IDENTITY', 'KYC_PROGRESS'],
    ['KYC', 'IPV'],
    ['IPV', 'PROFILE'],
  ] as const)
    app = completeStep(app, step, screen, now);
  void d.applications.create(app);
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
    reasons: [],
    nextScreen: 'PAN_IDENTITY',
    decidedAt: now,
  });
  const profile = new ProfileService(
    d.uow,
    d.applications,
    d.profiles,
    d.declarations,
    d.identities,
    d.compliance,
    d.tasks,
    d.audit,
    d.outbox,
    d.analytics,
    d.clock,
    d.ids,
    loadProfileRulebook(),
  );
  const declarations = new DeclarationsService(
    d.uow,
    d.applications,
    d.identities,
    d.eligibility,
    d.profiles,
    d.declarations,
    d.compliance,
    d.tasks,
    d.audit,
    d.outbox,
    d.analytics,
    d.clock,
    d.ids,
    loadTaxRulebook(),
  );
  const bank = new BankVerificationService(
    d.uow,
    d.applications,
    d.bank,
    d.audit,
    d.outbox,
    d.clock,
    d.ids,
    loadBankRulebook(),
    fingerprint,
  );
  const processor = new BankVerificationProcessor(
    new CorrelationStore(),
    silentLogger as never,
    d.uow,
    d.applications,
    d.bank,
    d.identities,
    d.tasks,
    d.gateway,
    d.storage,
    d.audit,
    d.analytics,
    d.clock,
    d.ids,
    loadBankRulebook(),
  );
  const nomination = new NominationService(
    d.uow,
    d.applications,
    d.nominations,
    d.audit,
    d.outbox,
    d.analytics,
    d.clock,
    loadNominationRulebook(),
  );
  return { d, profile, declarations, bank, processor, nomination };
}
const profileCmd = {
  applicationId: 'app_1',
  customerId: 'cus_1',
  occupation: 'PRIVATE_SECTOR',
  annualIncomeBand: 'INR_10L_25L',
  sourceOfFunds: ['SALARY'],
  profileVersion: 0,
};
const declCmd = {
  applicationId: 'app_1',
  customerId: 'cus_1',
  taxResidencies: [{ country: 'IN', tin: 'ABCPE1234F' }],
  pepDeclaration: 'NOT_PEP',
  declarationVersion: 'declarations_v1',
};
const bankCmd = {
  applicationId: 'app_1',
  customerId: 'cus_1',
  accountNumber: '999912345678',
  accountNumberConfirmation: '9999 1234 5678',
  ifsc: 'hdfc0001234',
  holderName: 'Vinod Kumar Singh',
};
const job = (attemptsMade = 0, attempts = 5) =>
  ({ attemptsMade, opts: { attempts } }) as never;

describe('ProfileService', () => {
  it('saves a versioned profile, advances to TAX_DECLARATIONS, and never puts answers in analytics', async () => {
    const { d, profile } = build();
    const r = await profile.save(profileCmd);
    expect(r).toEqual({
      status: 'COMPLETE',
      profileVersion: 1,
      nextScreen: 'TAX_DECLARATIONS',
    });
    expect(d.applications.rows.get('app_1')?.nextScreen).toBe(
      'TAX_DECLARATIONS',
    );
    expect(JSON.stringify(d.analytics.events)).not.toContain('INR_10L_25L');
    expect(d.tasks.rows).toHaveLength(0);
  });
  it('rejects a stale profile_version with 409 and writes nothing', async () => {
    const { d, profile } = build();
    await profile.save(profileCmd);
    await expect(profile.save(profileCmd)).rejects.toBeInstanceOf(
      StaleVersionError,
    );
    expect(d.profiles.rows).toHaveLength(1);
    await expect(
      profile.save({
        ...profileCmd,
        profileVersion: 1,
        occupation: 'BUSINESS',
      }),
    ).resolves.toMatchObject({ profileVersion: 2 });
  });
  it('opens an evidence task for policy-flagged sources and re-queues AML after declarations exist', async () => {
    const { d, profile, declarations } = build();
    await profile.save({
      ...profileCmd,
      sourceOfFunds: ['INHERITANCE'],
      sourceOfFundsExplanation: 'estate',
    });
    expect(d.tasks.rows[0]).toMatchObject({
      category: 'SOURCE_OF_FUNDS_EVIDENCE',
    });
    await declarations.save(declCmd);
    const before = d.compliance.assessments.length;
    const r = await profile.save({
      ...profileCmd,
      profileVersion: 1,
      occupation: 'BUSINESS',
    });
    expect(r.nextScreen).toBe('BANK_DETAILS');
    expect(d.compliance.assessments).toHaveLength(before + 1);
    expect(d.compliance.assessments[before]).toMatchObject({
      status: 'QUEUED',
      profileVersion: 2,
      declarationVersion: 1,
    });
    expect(d.compliance.assessments[before - 1].status).toBe('SUPERSEDED');
  });
  it('requires completed KYC and ownership', async () => {
    const { d, profile } = build();
    await d.applications.create(newApplication('app_2', 'cus_1', new Date()));
    await expect(
      profile.save({ ...profileCmd, applicationId: 'app_2' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      profile.save({ ...profileCmd, customerId: 'cus_x' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('DeclarationsService', () => {
  it('attests declarations, queues screening and AML, advances to BANK_DETAILS', async () => {
    const { d, profile, declarations } = build();
    await profile.save(profileCmd);
    const r = await declarations.save(declCmd);
    expect(r).toEqual({
      status: 'COMPLETE',
      additionalInformationRequired: false,
      nextScreen: 'BANK_DETAILS',
    });
    expect(d.compliance.runs[0]).toMatchObject({
      status: 'QUEUED',
      identityVersion: 1,
      screeningPolicyVersion: 'screening_v1',
    });
    expect(d.compliance.assessments[0]).toMatchObject({
      status: 'QUEUED',
      profileVersion: 1,
      declarationVersion: 1,
    });
    expect(d.declarations.rows[0].taxResidencies).toEqual([
      { country: 'IN', tin: 'ABCPE1234F', tinUnavailableReason: null },
    ]);
    expect(
      JSON.stringify(d.analytics.events) + JSON.stringify(d.audit.events),
    ).not.toContain('ABCPE1234F');
  });
  it('foreign residency and PEP open tasks; mismatching Indian TIN is rejected before anything is written', async () => {
    const { d, profile, declarations } = build();
    await profile.save(profileCmd);
    await expect(
      declarations.save({
        ...declCmd,
        taxResidencies: [{ country: 'IN', tin: 'ZZZZZ9999Z' }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(d.compliance.runs).toHaveLength(0);
    const r = await declarations.save({
      ...declCmd,
      taxResidencies: [
        ...declCmd.taxResidencies,
        { country: 'US', tin: '123' },
      ],
      pepDeclaration: 'RELATED_TO_PEP',
    });
    expect(r.additionalInformationRequired).toBe(true);
    expect(d.tasks.rows.map((t) => t.category).sort()).toEqual([
      'FATCA_ADDITIONAL_INFO',
      'PEP_EDD',
    ]);
  });
  it('requires the profile step first', async () => {
    const { declarations } = build();
    await expect(declarations.save(declCmd)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe('BankVerificationService and processor', () => {
  async function ready() {
    const b = build();
    await b.profile.save(profileCmd);
    await b.declarations.save(declCmd);
    return b;
  }
  it('starts a verification, dedupes repeated taps on the same account, and the processor verifies a good match', async () => {
    const { d, bank, processor } = await ready();
    const first = await bank.start(bankCmd);
    expect(first).toMatchObject({
      status: 'PROCESSING',
      nextScreen: 'BANK_PROGRESS',
    });
    const again = await bank.start(bankCmd);
    expect(again.verificationId).toBe(first.verificationId);
    expect(
      d.outbox.events.filter(
        (e) => e.eventType === 'BankVerificationRequested',
      ),
    ).toHaveLength(1);
    d.gateway.verify.mockResolvedValue({
      providerReference: 'FTI1',
      verified: true,
      fuzzyMatchScore: 92,
      raw: { id: 'FTI1' },
    });
    await processor.handle(
      { payload: { verificationId: first.verificationId } },
      job(),
    );
    expect(d.gateway.verify).toHaveBeenCalledWith(
      expect.objectContaining({
        accountNumber: '999912345678',
        ifsc: 'HDFC0001234',
        beneficiaryName: 'Vinod Kumar Singh',
        validationMode: 'AUTO',
      }),
    );
    const view = await bank.get('app_1', 'cus_1', first.verificationId);
    expect(view).toEqual({
      status: 'VERIFIED',
      accountMasked: '••••5678',
      requiredActions: [],
      nextScreen: 'NOMINATION',
    });
    expect(d.applications.rows.get('app_1')?.nextScreen).toBe('NOMINATION');
    expect(JSON.stringify(d.analytics.events)).not.toContain('92');
    await processor.handle(
      { payload: { verificationId: first.verificationId } },
      job(),
    ); // idempotent
    expect(d.gateway.verify).toHaveBeenCalledTimes(1);
  });
  it('low name-match score goes to review with a task; mismatch and failures require action; score never leaves', async () => {
    const { d, bank, processor } = await ready();
    const v1 = await bank.start(bankCmd);
    d.gateway.verify.mockResolvedValueOnce({
      verified: true,
      fuzzyMatchScore: 55,
      raw: {},
    });
    await processor.handle(
      { payload: { verificationId: v1.verificationId } },
      job(),
    );
    expect(await bank.get('app_1', 'cus_1', v1.verificationId)).toMatchObject({
      status: 'REVIEW_REQUIRED',
      nextScreen: 'ASSISTED_ONBOARDING',
    });
    expect(d.tasks.rows.at(-1)).toMatchObject({ category: 'BANK_NAME_REVIEW' });
    const v2 = await bank.start({
      ...bankCmd,
      accountNumber: '111112345678',
      accountNumberConfirmation: '111112345678',
    });
    d.gateway.verify.mockResolvedValueOnce({
      verified: false,
      errorCode: 'INVALID_ACCOUNT',
      raw: {},
    });
    await processor.handle(
      { payload: { verificationId: v2.verificationId } },
      job(),
    );
    expect(await bank.get('app_1', 'cus_1', v2.verificationId)).toMatchObject({
      status: 'ACTION_REQUIRED',
      requiredActions: ['CORRECT_DETAILS'],
      nextScreen: 'BANK_DETAILS',
    });
    expect(
      JSON.stringify(await bank.get('app_1', 'cus_1', v1.verificationId)),
    ).not.toContain('55');
  });
  it('provider outage retries then records TECHNICAL_ERROR; attempts are capped', async () => {
    const { d, bank, processor } = await ready();
    const v1 = await bank.start(bankCmd);
    d.gateway.verify.mockRejectedValue(new DependencyUnavailableError());
    await expect(
      processor.handle(
        { payload: { verificationId: v1.verificationId } },
        job(0, 3),
      ),
    ).rejects.toBeInstanceOf(DependencyUnavailableError);
    await processor.handle(
      { payload: { verificationId: v1.verificationId } },
      job(2, 3),
    );
    expect(await bank.get('app_1', 'cus_1', v1.verificationId)).toMatchObject({
      status: 'TECHNICAL_ERROR',
      nextScreen: 'BANK_PROGRESS',
    });
    await bank.start({
      ...bankCmd,
      accountNumber: '222212345678',
      accountNumberConfirmation: '222212345678',
    });
    await bank.start({
      ...bankCmd,
      accountNumber: '333312345678',
      accountNumberConfirmation: '333312345678',
    });
    await expect(
      bank.start({
        ...bankCmd,
        accountNumber: '444412345678',
        accountNumberConfirmation: '444412345678',
      }),
    ).rejects.toMatchObject({ details: { reason: 'max_attempts' } });
  });
  it('validates inputs, prerequisites and ownership on reads', async () => {
    const { bank } = await ready();
    await expect(
      bank.start({ ...bankCmd, accountNumberConfirmation: '999912345679' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      bank.start({ ...bankCmd, ifsc: 'BAD' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      bank.start({ ...bankCmd, holderName: 'V' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(bank.get('app_1', 'cus_1', 'bv_nope')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      bank.get('app_1', 'cus_other', 'bv_nope'),
    ).rejects.toBeInstanceOf(NotFoundError);
    const { bank: early } = build();
    await expect(early.start(bankCmd)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('NominationService', () => {
  it('captures a nomination after bank verification and advances; rejects before', async () => {
    const b = build();
    await b.profile.save(profileCmd);
    await b.declarations.save(declCmd);
    const cmd = {
      applicationId: 'app_1',
      customerId: 'cus_1',
      choice: 'NOMINATE' as const,
      allocationMode: 'EQUAL' as const,
      nominees: [
        { fullName: 'Asha Singh', relationship: 'SPOUSE', isMinor: false },
      ],
    };
    await expect(b.nomination.save(cmd)).rejects.toBeInstanceOf(
      ValidationError,
    );
    const app = b.d.applications.rows.get('app_1')!;
    await b.d.applications.saveWithVersionCheck(
      completeStep(app, 'BANK', 'NOMINATION', new Date()),
      app.version,
    );
    const r = await b.nomination.save(cmd);
    expect(r).toEqual({
      status: 'CAPTURED',
      registrationStatus: 'NOT_SUBMITTED',
      nominationVersion: 1,
      nextScreen: 'INVESTMENT_PROFILE',
    });
    expect(b.d.nominations.rows[0].nominees[0].allocationPercent).toBe(100);
    expect(
      JSON.stringify(b.d.analytics.events) + JSON.stringify(b.d.audit.events),
    ).not.toContain('Asha');
    expect(
      await b.nomination.save({ ...cmd, choice: 'OPT_OUT', nominees: [] }),
    ).toMatchObject({ nominationVersion: 2 });
    await expect(
      b.nomination.save({
        ...cmd,
        allocationMode: 'CUSTOM',
        nominees: [{ ...cmd.nominees[0], allocationPercent: 99 }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(b.d.nominations.rows).toHaveLength(2);
  });
});

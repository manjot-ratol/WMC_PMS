import {
  FakeAccountOpening,
  FakeActivations,
  FakeAnalytics,
  FakeApplications,
  FakeAudit,
  FakeBank,
  FakeCompliance,
  FakeCustomers,
  FakeDocuments,
  FakeEligibility,
  FakeEsign,
  FakeFunding,
  FakeIdentities,
  FakeJobs,
  FakeKycRecords,
  FakeOutbox,
  FakeRenderer,
  FakeReviews,
  FakeSigning,
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
  NotFoundError,
  StaleVersionError,
  ValidationError,
} from '../../common/errors/app-error';
import { loadAccountOpeningRulebook } from '../../domain/account-opening/account-opening';
import { loadActivationRulebook } from '../../domain/activation/activation';
import { loadDocumentPackRulebook } from '../../domain/documents/document-pack';
import { loadFundingRulebook } from '../../domain/funding/funding';
import {
  completeStep,
  newApplication,
  type OnboardingApplication,
} from '../../domain/onboarding/application';
import type { ReviewSections } from '../../domain/review/review-snapshot';
import { toIsoDate } from '../../domain/shared/iso-date';
import { AccountOpeningService } from '../account-opening/account-opening.service';
import { FundingService } from '../funding/funding.service';
import { AccountOpeningProcessor } from '../jobs/account-opening.processor';
import { ActivationProcessor } from '../jobs/activation.processor';
import { SigningStatusProcessor } from '../jobs/signing-status.processor';
import { ProcessingService } from '../processing/processing.service';
import { SigningService } from './signing.service';

const sections = {
  identity: {
    version: 1,
    legalName: 'Vinod Kumar Singh',
    panMasked: 'AB••••••4F',
    dateOfBirth: '1990-01-15',
  },
  kyc: { version: 2, status: 'COMPLETE', route: 'REUSE' },
  profile: {
    version: 1,
    occupation: 'PRIVATE_SECTOR',
    annualIncomeBand: 'INR_10L_25L',
    sourceOfFunds: ['SALARY'],
  },
  declarations: {
    version: 1,
    taxResidencyCountries: ['IN'],
    pepDeclaration: 'NOT_PEP',
    declarationVersion: 'declarations_v1',
  },
  bank: {
    verificationId: 'bv_1',
    accountMasked: '••••5678',
    ifsc: 'HDFC0001234',
    holderName: 'Vinod Kumar Singh',
  },
  nomination: { version: 1, choice: 'OPT_OUT', nomineeCount: 0 },
  suitability: {
    assessmentId: 'sa_1',
    version: 1,
    riskProfile: 'GROWTH',
    questionnaireVersion: 'suitability_v1',
  },
  approach: { version: 1, approachCode: 'EQUITY_GROWTH', assessmentVersion: 1 },
  acknowledgements: { version: 1, documentPackVersion: 1, documents: [] },
  eligibility: {
    version: 1,
    intendedInvestmentInr: 5_000_000,
    journeyRoute: 'RESIDENT_SINGLE_HOLDER',
  },
} as unknown as ReviewSections;

function build(
  opts: {
    kycRoute?: 'REUSE' | 'FRESH';
    screening?: 'PROCEED' | 'REVIEW' | 'QUEUED';
  } = {},
) {
  const fingerprint = new Fingerprint({
    fingerprintKeyBase64: Buffer.alloc(32, 3).toString('base64'),
  });
  const clock = new FixedClock();
  const now = clock.now();
  const d = {
    uow: new FakeUow(),
    applications: new FakeApplications(),
    customers: new FakeCustomers((p) => p),
    identities: new FakeIdentities((p) => p),
    kyc: new FakeKycRecords(),
    eligibility: new FakeEligibility(),
    bank: new FakeBank((a) => fingerprint.of(a, 'account')),
    reviews: new FakeReviews(),
    signing: new FakeSigning(),
    accounts: new FakeAccountOpening(),
    funding: new FakeFunding(),
    activations: new FakeActivations(),
    compliance: new FakeCompliance(),
    tasks: new FakeTasks(),
    documents: new FakeDocuments(),
    storage: new FakeStorage(),
    esign: new FakeEsign(),
    renderer: new FakeRenderer(),
    kra: {
      register: jest.fn(),
      checkPanStatus: jest.fn(),
      fetchDetails: jest.fn(),
      downloadDocuments: jest.fn(),
    },
    jobs: new FakeJobs(),
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
    ['SUITABILITY', 'INVESTMENT_APPROACH'],
    ['APPROACH', 'FEES_DISCLOSURES'],
    ['ACKNOWLEDGEMENTS', 'APPLICATION_REVIEW'],
    ['REVIEW', 'SIGN_DOCUMENTS'],
  ] as const)
    app = completeStep(app, step, screen, now);
  void d.applications.create(app);
  void d.customers.create({
    id: 'cus_1',
    phone: '+919000000001' as never,
    email: 'vinod@example.com' as never,
    state: 'VERIFIED',
    version: 1,
    createdAt: now,
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
    route: opts.kycRoute ?? 'REUSE',
    operationId: 'op_1',
    version: 2,
    updatedAt: now,
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
    journeyRoute: 'RESIDENT_SINGLE_HOLDER',
    reasons: [],
    nextScreen: 'PAN_IDENTITY',
    decidedAt: now,
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
  void d.reviews.create({
    id: 'snap_1',
    applicationId: 'app_1',
    confirmedApplicationVersion: app.version - 1,
    applicationVersion: app.version,
    documentPackVersion: 1,
    sections,
    hash: 'h'.repeat(64),
    status: 'CURRENT',
    confirmedAt: now,
  });
  void d.compliance.createScreeningRun({
    id: 'sr_1',
    applicationId: 'app_1',
    identityVersion: 1,
    screeningPolicyVersion: 'screening_v1',
    status: opts.screening ?? 'PROCEED',
    createdAt: now,
  });
  void d.compliance.createAmlAssessment({
    id: 'aml_1',
    applicationId: 'app_1',
    identityVersion: 1,
    profileVersion: 1,
    declarationVersion: 1,
    policyVersion: 'aml_v1',
    status: 'PROCEED',
    createdAt: now,
  });
  const pack = loadDocumentPackRulebook();
  const fundingCfg = {
    beneficiaryName: 'POOL',
    beneficiaryAccountNumber: '123456789012',
    beneficiaryIfsc: 'SBIN0000001',
    beneficiaryBankName: 'SBI',
  };
  const signing = new SigningService(
    d.uow,
    d.applications,
    d.customers,
    d.identities,
    d.reviews,
    d.signing,
    d.renderer,
    d.storage,
    d.esign,
    d.audit,
    d.outbox,
    d.analytics,
    d.clock,
    d.ids,
    pack,
  );
  const signingProcessor = new SigningStatusProcessor(
    new CorrelationStore(),
    silentLogger as never,
    d.uow,
    d.applications,
    d.signing,
    d.reviews,
    d.esign,
    d.storage,
    d.jobs,
    d.audit,
    d.outbox,
    d.analytics,
    d.clock,
  );
  const processing = new ProcessingService(
    d.uow,
    d.applications,
    d.tasks,
    d.documents,
    d.audit,
    d.clock,
    d.ids,
  );
  const accountOpening = new AccountOpeningService(
    d.uow,
    d.applications,
    d.reviews,
    d.accounts,
    d.tasks,
    d.audit,
    d.outbox,
    d.analytics,
    d.clock,
    d.ids,
    loadAccountOpeningRulebook(),
  );
  const accountProcessor = new AccountOpeningProcessor(
    new CorrelationStore(),
    silentLogger as never,
    d.uow,
    d.applications,
    d.reviews,
    d.signing,
    d.accounts,
    d.identities,
    d.kyc,
    d.tasks,
    d.kra,
    d.storage,
    d.audit,
    d.analytics,
    d.clock,
    d.ids,
    loadAccountOpeningRulebook(),
  );
  const funding = new FundingService(
    d.uow,
    d.applications,
    d.eligibility,
    d.bank,
    d.signing,
    d.accounts,
    d.funding,
    d.compliance,
    d.activations,
    d.tasks,
    d.audit,
    d.outbox,
    d.analytics,
    d.clock,
    d.ids,
    loadFundingRulebook(),
    loadAccountOpeningRulebook(),
    loadActivationRulebook(),
    fundingCfg,
    fingerprint,
  );
  const activation = new ActivationProcessor(
    new CorrelationStore(),
    silentLogger as never,
    d.uow,
    d.applications,
    d.activations,
    funding,
    d.audit,
    d.outbox,
    d.analytics,
    d.clock,
    d.ids,
  );
  return {
    d,
    signing,
    signingProcessor,
    processing,
    accountOpening,
    accountProcessor,
    funding,
    activation,
    app: () => d.applications.rows.get('app_1')!,
  };
}
const base = { applicationId: 'app_1', customerId: 'cus_1' };
const signCmd = {
  ...base,
  snapshotId: 'snap_1',
  documentPackVersion: 1,
  signingMethod: 'AADHAAR_ESIGN' as const,
};

async function executed(b: ReturnType<typeof build>) {
  const s = await b.signing.create(signCmd);
  b.d.esign.status = {
    providerDocumentId: 'DID1',
    agreementStatus: 'completed',
    signers: [{ status: 'signed' }],
    raw: {},
  };
  await b.signingProcessor.handle({
    payload: { signingSessionId: s.signingSessionId },
  });
  await b.accountProcessor.handle({
    payload: { signingSessionId: s.signingSessionId },
  });
  return s;
}
async function accountsReady(b: ReturnType<typeof build>) {
  await b.accountOpening.recordUnderlyingAccount({
    applicationId: 'app_1',
    providerReceiptKey: 'k-pms',
    provider: 'CUSTODIAN',
    accountType: 'PMS_ACCOUNT',
    accountReference: 'PMS0001',
    status: 'READY',
  });
  return b.accountOpening.recordUnderlyingAccount({
    applicationId: 'app_1',
    providerReceiptKey: 'k-demat',
    provider: 'DP',
    accountType: 'DEMAT',
    accountReference: 'DEMAT0001',
    status: 'READY',
  });
}

describe('SigningService', () => {
  it('renders the pack from the snapshot, hashes every document, and opens one sign request per snapshot', async () => {
    const { d, signing } = build();
    const r = await signing.create(signCmd);
    expect(r).toMatchObject({
      status: 'REQUESTED',
      providerRequestId: 'DID1',
      sdkLaunch: { accessToken: 'GWT1' },
    });
    const session = (await d.signing.findById(r.signingSessionId))!;
    expect(session.documents.map((x) => x.documentType)).toEqual([
      'MITC',
      'PMS_AGREEMENT',
      'FEE_ANNEXURE',
      'ACCOUNT_OPENING_FORM',
    ]);
    expect(
      session.documents.every((x) => /^[0-9a-f]{64}$/.test(x.sha256)),
    ).toBe(true);
    expect(d.storage.objects.has(session.packObjectKey)).toBe(true);
    expect(d.esign.requests[0]).toMatchObject({
      signer: { identifier: 'vinod@example.com', name: 'Vinod Kumar Singh' },
      referenceId: 'app_1',
      customReference: r.signingSessionId,
    });
    expect(
      d.storage.objects.get(session.documents[1].objectKey)!.body.toString(),
    ).toContain('AB••••••4F');
    const again = await signing.create(signCmd);
    expect(again.signingSessionId).toBe(r.signingSessionId);
    expect(again.sdkLaunch.accessToken).toBeUndefined();
    expect(d.esign.requests).toHaveLength(1);
    expect(await signing.get('app_1', 'cus_1', r.signingSessionId)).toEqual({
      status: 'REQUESTED',
      documentPackVersion: 1,
      evidenceAvailable: false,
      nextScreen: 'SIGN_DOCUMENTS',
    });
    expect(JSON.stringify(d.analytics.events)).not.toMatch(/DID1|GWT1/);
  });
  it('refuses a stale snapshot, a changed application, an old pack, a missing REVIEW step and other owners', async () => {
    const b = build();
    await expect(
      b.signing.create({ ...signCmd, snapshotId: 'snap_old' }),
    ).rejects.toBeInstanceOf(StaleVersionError);
    await expect(
      b.signing.create({ ...signCmd, documentPackVersion: 0 }),
    ).rejects.toBeInstanceOf(StaleVersionError);
    const app = b.app();
    await b.d.applications.saveWithVersionCheck(
      { ...app, version: app.version + 1 },
      app.version,
    );
    await expect(b.signing.create(signCmd)).rejects.toMatchObject({
      details: { reason: 'application_changed_since_review' },
    });
    await expect(
      b.signing.create({ ...signCmd, customerId: 'cus_x' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      b.signing.get('app_1', 'cus_1', 'ss_nope'),
    ).rejects.toBeInstanceOf(NotFoundError);
    const early = build();
    await early.d.applications.create(
      newApplication('app_2', 'cus_1', new Date()),
    );
    await expect(
      early.signing.create({ ...signCmd, applicationId: 'app_2' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('SigningStatusProcessor', () => {
  it('requested with a signed party stays in progress; completed + signed executes, stores evidence and submits the application', async () => {
    const b = build();
    const s = await b.signing.create(signCmd);
    b.d.esign.status = {
      providerDocumentId: 'DID1',
      agreementStatus: 'requested',
      signers: [{ status: 'signed' }],
      raw: {},
    };
    await b.signingProcessor.handle({
      payload: { signingSessionId: s.signingSessionId },
    });
    expect((await b.d.signing.findById(s.signingSessionId))!.status).toBe(
      'IN_PROGRESS',
    );
    expect(b.app().status).toBe('IN_PROGRESS');
    expect(b.d.jobs.published.at(-1)).toMatchObject({
      queue: 'signing-status',
      name: 'poll',
    });
    b.d.esign.status = {
      providerDocumentId: 'DID1',
      agreementStatus: 'completed',
      signers: [{ status: 'signed' }],
      raw: {},
    };
    await b.signingProcessor.handle({
      payload: { signingSessionId: s.signingSessionId },
    });
    const session = (await b.d.signing.findById(s.signingSessionId))!;
    expect(session).toMatchObject({
      status: 'EXECUTED',
      evidenceKey: expect.stringContaining('signed-pack.pdf') as string,
    });
    expect(b.app()).toMatchObject({
      status: 'SUBMITTED',
      nextScreen: 'APPLICATION_PROCESSING',
    });
    expect(b.d.outbox.events.map((e) => e.eventType)).toContain(
      'DocumentPackExecuted',
    );
    expect(
      await b.signing.get('app_1', 'cus_1', s.signingSessionId),
    ).toMatchObject({
      status: 'EXECUTED',
      evidenceAvailable: true,
      nextScreen: 'APPLICATION_PROCESSING',
    });
    await b.signingProcessor.handle({
      payload: { signingSessionId: s.signingSessionId },
    }); // terminal: no-op
    expect(
      b.d.analytics.events.filter((e) => e.name === 'Document Pack Executed'),
    ).toHaveLength(1);
  });
  it('a session whose snapshot was superseded is marked SUPERSEDED and never executes; terminal provider states are recorded', async () => {
    const b = build();
    const s = await b.signing.create(signCmd);
    await b.d.reviews.supersedeCurrent('app_1');
    await b.d.reviews.create({
      id: 'snap_2',
      applicationId: 'app_1',
      confirmedApplicationVersion: 9,
      applicationVersion: 10,
      documentPackVersion: 1,
      sections,
      hash: 'i'.repeat(64),
      status: 'CURRENT',
      confirmedAt: new Date(),
    });
    b.d.esign.status = {
      providerDocumentId: 'DID1',
      agreementStatus: 'completed',
      signers: [{ status: 'signed' }],
      raw: {},
    };
    await b.signingProcessor.handle({
      payload: { signingSessionId: s.signingSessionId },
    });
    expect((await b.d.signing.findById(s.signingSessionId))!.status).toBe(
      'SUPERSEDED',
    );
    expect(b.app().status).toBe('IN_PROGRESS');
    expect(b.d.audit.events.at(-1)?.action).toBe('signing_session.superseded');
    const c = build();
    const s2 = await c.signing.create(signCmd);
    c.d.esign.status = {
      providerDocumentId: 'DID1',
      agreementStatus: 'expired',
      signers: [{ status: 'requested' }],
      raw: {},
    };
    await c.signingProcessor.handle({
      payload: { signingSessionId: s2.signingSessionId },
    });
    expect((await c.d.signing.findById(s2.signingSessionId))!).toMatchObject({
      status: 'EXPIRED',
      safeErrorCategory: 'sign_request_expired',
    });
    const r = await c.signing.create(signCmd); // a new request may be made after expiry
    expect(r.signingSessionId).not.toBe(s2.signingSessionId);
  });
});

describe('ProcessingService', () => {
  it('shows only customer-visible tasks and accepts a response to an open customer task', async () => {
    const b = build();
    await executed(b);
    await b.d.tasks.create({
      id: 't_pep',
      applicationId: 'app_1',
      category: 'PEP_EDD',
      status: 'OPEN',
      createdAt: new Date(),
    });
    await b.d.tasks.create({
      id: 't_clar',
      applicationId: 'app_1',
      category: 'CLARIFICATION',
      status: 'OPEN',
      createdAt: new Date(),
    });
    const s = await b.processing.status('app_1', 'cus_1');
    expect(s).toMatchObject({
      applicationStatus: 'PROCESSING',
      customerActionRequired: true,
      nextScreen: 'APPLICATION_PROCESSING',
    });
    expect(s.tasks.map((t) => t.category).sort()).toEqual([
      'ACCOUNT_SETUP',
      'CLARIFICATION',
    ]);
    await expect(
      b.processing.respond({
        ...base,
        taskId: 't_pep',
        responseType: 'TEXT',
        documentIds: [],
        text: 'x',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      b.processing.respond({
        ...base,
        taskId: 't_clar',
        responseType: 'DOCUMENT',
        documentIds: ['doc_other'],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      b.processing.respond({
        ...base,
        taskId: 't_clar',
        responseType: 'TEXT',
        documentIds: [],
        text: '  ',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const r = await b.processing.respond({
      ...base,
      taskId: 't_clar',
      responseType: 'TEXT',
      documentIds: [],
      text: 'Salary slips attached earlier.',
    });
    expect(r).toEqual({ status: 'SUBMITTED', taskStatus: 'UNDER_REVIEW' });
    expect(b.d.tasks.responses[0]).toMatchObject({
      taskId: 't_clar',
      text: 'Salary slips attached earlier.',
    });
    expect(
      (await b.processing.status('app_1', 'cus_1')).customerActionRequired,
    ).toBe(false);
    await expect(
      b.processing.respond({
        ...base,
        taskId: 't_clar',
        responseType: 'TEXT',
        documentIds: [],
        text: 'again',
      }),
    ).rejects.toMatchObject({
      details: { reason: 'task_not_awaiting_customer' },
    });
    expect(JSON.stringify(b.d.audit.events)).not.toContain('Salary slips');
  });
});

describe('Account opening', () => {
  it('after execution the run files NOT_REQUIRED KRA for a reused record, opens the setup task and waits for the custodian feed', async () => {
    const b = build();
    await executed(b);
    const run = (await b.d.accounts.latestRun('app_1'))!;
    expect(run.status).toBe('SUBMITTED');
    expect(
      b.d.accounts.submissions.map((s) => [s.registry, s.status, s.basis]),
    ).toEqual([
      ['KRA', 'NOT_REQUIRED', 'EXISTING_KRA_RECORD'],
      ['CKYC', 'NOT_REQUIRED', 'CKYC_DISABLED_BY_POLICY'],
    ]);
    expect(b.d.kra.register).not.toHaveBeenCalled();
    expect(
      b.d.tasks.rows.find((t) => t.category === 'ACCOUNT_SETUP')?.status,
    ).toBe('IN_PROGRESS');
    await b.accountProcessor.handle({
      payload: {
        signingSessionId: (await b.d.signing.latestForApplication('app_1'))!.id,
      },
    }); // duplicate trigger is a no-op
    expect(b.d.accounts.runs.size).toBe(1);
    const first = await b.accountOpening.recordUnderlyingAccount({
      applicationId: 'app_1',
      providerReceiptKey: 'k-pms',
      provider: 'CUSTODIAN',
      accountType: 'PMS_ACCOUNT',
      accountReference: 'PMS0001',
      status: 'READY',
    });
    expect(first).toMatchObject({ status: 'RECORDED', accountsReady: false });
    const dup = await b.accountOpening.recordUnderlyingAccount({
      applicationId: 'app_1',
      providerReceiptKey: 'k-pms',
      provider: 'CUSTODIAN',
      accountType: 'PMS_ACCOUNT',
      accountReference: 'PMS0001',
      status: 'READY',
    });
    expect(dup).toMatchObject({
      accountId: first.accountId,
      status: 'DUPLICATE',
    });
    const ready = await b.accountOpening.recordUnderlyingAccount({
      applicationId: 'app_1',
      providerReceiptKey: 'k-demat',
      provider: 'DP',
      accountType: 'DEMAT',
      accountReference: 'DEMAT0001',
      status: 'READY',
    });
    expect(ready.accountsReady).toBe(true);
    expect(b.app()).toMatchObject({ nextScreen: 'FUNDING_INSTRUCTIONS' });
    expect((await b.d.accounts.latestRun('app_1'))!.status).toBe(
      'ACCOUNTS_READY',
    );
    expect(
      b.d.tasks.rows.find((t) => t.category === 'ACCOUNT_SETUP')?.status,
    ).toBe('RESOLVED');
    expect(b.d.analytics.events.map((e) => e.name)).toContain(
      'Underlying Account Ready',
    );
    expect(JSON.stringify(b.d.analytics.events)).not.toContain('PMS0001');
  });
  it('fresh KYC registers with KRA (deadline tracked); provider rejection becomes an ERROR submission with an exception task', async () => {
    const b = build({ kycRoute: 'FRESH' });
    b.d.kra.register.mockResolvedValue({
      requestId: 'KRAREQ1',
      status: 'SUBMITTED',
      raw: {},
    });
    await executed(b);
    const kra = b.d.accounts.submissions.find((s) => s.registry === 'KRA')!;
    expect(kra).toMatchObject({
      status: 'SUBMITTED',
      providerRequestId: 'KRAREQ1',
    });
    expect(kra.deadlineAt!.getTime() - b.d.clock.now().getTime()).toBe(
      10 * 24 * 3600 * 1000,
    );
    expect(b.d.kra.register).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceProvider: 'CDSL',
        registration: expect.objectContaining({
          pan_no: 'ABCPE1234F',
        }) as Record<string, unknown>,
      }) as Record<string, unknown>,
    );
    const c = build({ kycRoute: 'FRESH' });
    c.d.kra.register.mockResolvedValue({
      status: 'VALIDATION_ERROR',
      error: { code: 'ERR-90019', message: 'bad' },
      raw: {},
    });
    await executed(c);
    expect(
      c.d.accounts.submissions.find((s) => s.registry === 'KRA'),
    ).toMatchObject({
      status: 'ERROR',
      safeErrorCategory: 'kra_validation_error',
    });
    expect(
      c.d.tasks.rows.some((t) => t.category === 'REGISTRY_FILING_EXCEPTION'),
    ).toBe(true);
  });
  it('ops re-queue requires the current snapshot; the run is blocked when documents are not executed', async () => {
    const b = build();
    await expect(
      b.accountOpening.requestRun({
        applicationId: 'app_1',
        snapshotId: 'snap_x',
        documentPackVersion: 1,
        requestedBy: 'ops',
      }),
    ).rejects.toBeInstanceOf(StaleVersionError);
    const r = await b.accountOpening.requestRun({
      applicationId: 'app_1',
      snapshotId: 'snap_1',
      documentPackVersion: 1,
      requestedBy: 'ops',
    });
    await b.accountProcessor.handle({ payload: { runId: r.runId } });
    expect((await b.d.accounts.findRun(r.runId))!).toMatchObject({
      status: 'BLOCKED',
      blockers: ['application_not_submitted', 'documents_not_executed'],
    });
  });
});

describe('Funding and activation', () => {
  const receipt = (
    key: string,
    over: Partial<{
      amountInr: number;
      sourceAccountNumber: string;
      destinationReference: string;
      currency: string;
    }> = {},
  ) => ({
    applicationId: 'app_1',
    providerReceiptKey: key,
    provider: 'BANK',
    amountInr: 5_000_000,
    currency: 'INR',
    sourceAccountNumber: '999912345678',
    destinationReference: 'PMS-00000001',
    valueDate: '2026-10-18',
    ...over,
  });
  it('instructions are withheld until execution and account readiness, then come from configuration', async () => {
    const b = build();
    await expect(
      b.funding.instructions('app_1', 'cus_1'),
    ).rejects.toMatchObject({ details: { reason: 'documents_not_executed' } });
    await executed(b);
    await expect(
      b.funding.instructions('app_1', 'cus_1'),
    ).rejects.toMatchObject({ details: { reason: 'accounts_not_ready' } });
    await accountsReady(b);
    const i = await b.funding.instructions('app_1', 'cus_1');
    expect(i).toEqual({
      status: 'READY',
      instructionsVersion: 1,
      beneficiaryDetails: {
        accountName: 'POOL',
        accountNumberMasked: '••••9012',
        ifsc: 'SBIN0000001',
        bankName: 'SBI',
      },
      paymentReference: 'PMS-00000001',
      requiredAmountInr: 5_000_000,
    });
    const n = await b.funding.notify({
      ...base,
      fundingMethod: 'BANK_TRANSFER',
      customerTransferReference: 'UTR123456',
    });
    expect(n).toMatchObject({
      status: 'AWAITING_RECONCILIATION',
      nextScreen: 'FUNDING_STATUS',
    });
    await expect(
      b.funding.notify({
        ...base,
        fundingMethod: 'CASH',
        customerTransferReference: 'UTR123456',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await b.funding.status('app_1', 'cus_1')).toMatchObject({
      fundingStatus: 'AWAITING_FUNDS',
      activationStatus: 'NOT_READY',
      nextScreen: 'FUNDING_STATUS',
    });
    expect(JSON.stringify(b.d.audit.events)).not.toContain('UTR123456');
  });
  it('receipts: duplicate keys count once, foreign source accounts are unmatched with a review task, reconciliation triggers activation exactly once', async () => {
    const b = build();
    await executed(b);
    await accountsReady(b);
    const wrong = await b.funding.recordReceipt(
      receipt('r-wrong', { sourceAccountNumber: '111112345678' }),
    );
    expect(wrong).toMatchObject({
      status: 'RECORDED',
      matchStatus: 'UNMATCHED',
      fundingStatus: 'AWAITING_FUNDS',
    });
    expect(b.d.tasks.rows.some((t) => t.category === 'FUNDING_REVIEW')).toBe(
      true,
    );
    const part = await b.funding.recordReceipt(
      receipt('r-1', { amountInr: 2_000_000 }),
    );
    expect(part).toMatchObject({
      matchStatus: 'MATCHED',
      fundingStatus: 'PARTIAL',
    });
    expect(
      await b.funding.recordReceipt(receipt('r-1', { amountInr: 2_000_000 })),
    ).toMatchObject({ status: 'DUPLICATE', fundingStatus: 'PARTIAL' });
    const full = await b.funding.recordReceipt(
      receipt('r-2', { amountInr: 3_000_000 }),
    );
    expect(full.fundingStatus).toBe('RECONCILED');
    expect(
      b.d.outbox.events.filter((e) => e.eventType === 'FundingRequirementMet'),
    ).toHaveLength(1);
    expect(
      b.d.analytics.events.filter((e) => e.name === 'Funding Requirement Met'),
    ).toHaveLength(1);
    expect(JSON.stringify(b.d.analytics.events)).not.toMatch(
      /3000000|999912345678/,
    );
    // the open FUNDING_REVIEW task blocks activation until ops resolve it
    expect(await b.funding.status('app_1', 'cus_1')).toMatchObject({
      fundingStatus: 'RECONCILED',
      activationStatus: 'BLOCKED',
      nextScreen: 'ACTIVATION_PROGRESS',
    });
    await b.activation.handle({ payload: { applicationId: 'app_1' } });
    expect(b.app().status).toBe('SUBMITTED');
    const t = b.d.tasks.rows.find((x) => x.category === 'FUNDING_REVIEW')!;
    await b.d.tasks.update({ ...t, status: 'RESOLVED' });
    expect((await b.funding.status('app_1', 'cus_1')).activationStatus).toBe(
      'READY_FOR_ACTIVATION',
    );
    await b.activation.handle({ payload: { applicationId: 'app_1' } });
    await b.activation.handle({ payload: { applicationId: 'app_1' } });
    expect(b.app()).toMatchObject({
      status: 'ACTIVE',
      nextScreen: 'PORTFOLIO',
    });
    expect(b.d.activations.rows).toHaveLength(1);
    expect(b.d.activations.rows[0].pmsAccountId).toBe('PMS0001');
    expect(
      b.d.analytics.events.filter((e) => e.name === 'PMS Account Activated'),
    ).toHaveLength(1);
    expect(await b.funding.completion('app_1', 'cus_1')).toEqual({
      applicationStatus: 'ACTIVE',
      pmsAccountId: 'PMS0001',
      onboardingComplete: true,
      firstInvestmentStatus: 'NOT_STARTED',
      nextScreen: 'PORTFOLIO',
    });
    expect(await b.funding.status('app_1', 'cus_1')).toMatchObject({
      activationStatus: 'ACTIVE',
      nextScreen: 'PORTFOLIO',
    });
    expect(
      (await b.processing.status('app_1', 'cus_1')).applicationStatus,
    ).toBe('ACTIVE');
  });
  it('funds reconciled but screening under review: BLOCKED, application stays SUBMITTED; completion is 422 until active', async () => {
    const b = build({ screening: 'REVIEW' });
    await executed(b);
    await accountsReady(b);
    await b.funding.recordReceipt(receipt('r-full'));
    await b.activation.handle({ payload: { applicationId: 'app_1' } });
    expect(b.app().status).toBe('SUBMITTED');
    expect(await b.funding.status('app_1', 'cus_1')).toMatchObject({
      fundingStatus: 'RECONCILED',
      activationStatus: 'NOT_READY',
    });
    await expect(b.funding.completion('app_1', 'cus_1')).rejects.toMatchObject({
      details: { reason: 'not_active' },
    });
    expect(b.d.activations.rows).toHaveLength(0);
    await expect(
      b.funding.recordReceipt({ ...receipt('r-x'), applicationId: 'app_nope' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

function _unused(_a: OnboardingApplication): void {
  void _a;
}
void _unused;

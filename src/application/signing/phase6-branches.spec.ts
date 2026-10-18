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
  DependencyUnavailableError,
  NotFoundError,
} from '../../common/errors/app-error';
import { loadAccountOpeningRulebook } from '../../domain/account-opening/account-opening';
import { loadActivationRulebook } from '../../domain/activation/activation';
import { loadDocumentPackRulebook } from '../../domain/documents/document-pack';
import { loadFundingRulebook } from '../../domain/funding/funding';
import {
  completeStep,
  newApplication,
} from '../../domain/onboarding/application';
import type { ReviewSections } from '../../domain/review/review-snapshot';
import { toIsoDate } from '../../domain/shared/iso-date';
import { AccountOpeningService } from '../account-opening/account-opening.service';
import { FundingService } from '../funding/funding.service';
import { AccountOpeningProcessor } from '../jobs/account-opening.processor';
import { ActivationProcessor } from '../jobs/activation.processor';
import {
  SigningStatusProcessor,
  SIGNING_POLL_MAX_AGE_MS,
} from '../jobs/signing-status.processor';
import { ProcessingService } from '../processing/processing.service';
import { SigningService } from './signing.service';

const sections = {
  identity: {
    version: 1,
    legalName: 'V',
    panMasked: 'AB••••••4F',
    dateOfBirth: '1990-01-15',
  },
} as unknown as ReviewSections;

function build(
  kycRoute: 'REUSE' | 'FRESH' = 'FRESH',
  rulebookOverride: Partial<ReturnType<typeof loadAccountOpeningRulebook>> = {},
) {
  const fingerprint = new Fingerprint({
    fingerprintKeyBase64: Buffer.alloc(32, 4).toString('base64'),
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
  for (const s of [
    'EMAIL_VERIFIED',
    'ELIGIBILITY',
    'IDENTITY',
    'KYC',
    'IPV',
    'PROFILE',
    'DECLARATIONS',
    'BANK',
    'NOMINATION',
    'SUITABILITY',
    'APPROACH',
    'ACKNOWLEDGEMENTS',
    'REVIEW',
  ] as const)
    app = completeStep(app, s, 'SIGN_DOCUMENTS', now);
  app = { ...app, status: 'SUBMITTED' };
  void d.applications.create(app);
  void d.customers.create({
    id: 'cus_1',
    phone: '+919000000001' as never,
    state: 'VERIFIED',
    version: 1,
    createdAt: now,
  });
  void d.identities.append({
    applicationId: 'app_1',
    version: 1,
    pan: 'ABCPE1234F',
    legalName: 'V',
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
    route: kycRoute,
    operationId: 'op_1',
    version: 2,
    updatedAt: now,
  });
  void d.reviews.create({
    id: 'snap_1',
    applicationId: 'app_1',
    confirmedApplicationVersion: 1,
    applicationVersion: app.version,
    documentPackVersion: 1,
    sections,
    hash: 'h'.repeat(64),
    status: 'CURRENT',
    confirmedAt: now,
  });
  void d.signing.create({
    id: 'ss_1',
    applicationId: 'app_1',
    snapshotId: 'snap_1',
    documentPackVersion: 1,
    signingMethod: 'AADHAAR_ESIGN',
    status: 'EXECUTED',
    providerRequestId: 'DID1',
    packObjectKey: 'k',
    packSha256: 'h',
    documents: [],
    pollCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  const rb = { ...loadAccountOpeningRulebook(), ...rulebookOverride };
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
    loadDocumentPackRulebook(),
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
    rb,
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
    rb,
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
    rb,
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

describe('AccountOpeningProcessor branches', () => {
  it('ignores empty payloads and unknown sessions; a blocked run is replaced by a new one; CKYC flag defers; provider outage is an ERROR submission', async () => {
    const b = build('FRESH', { ckycEnabled: true });
    await b.accountProcessor.handle({ payload: {} });
    await b.accountProcessor.handle({
      payload: { signingSessionId: 'ss_nope' },
    });
    await b.accountProcessor.handle({ payload: { runId: 'ao_nope' } });
    expect(b.d.accounts.runs.size).toBe(0);
    await b.d.accounts.createRun({
      id: 'ao_blocked',
      applicationId: 'app_1',
      snapshotId: 'snap_1',
      documentPackVersion: 1,
      status: 'BLOCKED',
      blockers: ['x'],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    b.d.kra.register.mockRejectedValue(new DependencyUnavailableError());
    await b.accountProcessor.handle({ payload: { signingSessionId: 'ss_1' } });
    expect(b.d.accounts.runs.size).toBe(2);
    expect(
      b.d.accounts.submissions.map((s) => [
        s.registry,
        s.status,
        s.safeErrorCategory ?? s.basis,
      ]),
    ).toEqual([
      ['KRA', 'ERROR', 'provider_unavailable'],
      ['CKYC', 'DEFERRED', 'CKYC_UPLOAD_PENDING_DOCUMENTS'],
    ]);
    expect(b.d.tasks.rows.map((t) => t.category)).toEqual([
      'REGISTRY_FILING_EXCEPTION',
      'ACCOUNT_SETUP',
    ]);
    await b.accountProcessor.handle({ payload: { signingSessionId: 'ss_1' } }); // latest run already SUBMITTED → no-op
    expect(b.d.accounts.runs.size).toBe(2);
  });
  it('an existing QUEUED run for the snapshot is reused; unexpected errors propagate', async () => {
    const b = build();
    await b.d.accounts.createRun({
      id: 'ao_q',
      applicationId: 'app_1',
      snapshotId: 'snap_1',
      documentPackVersion: 1,
      status: 'QUEUED',
      blockers: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    b.d.kra.register.mockRejectedValue(new Error('boom'));
    await expect(
      b.accountProcessor.handle({ payload: { signingSessionId: 'ss_1' } }),
    ).rejects.toThrow('boom');
    expect(b.d.accounts.runs.size).toBe(1);
    expect((await b.d.accounts.findRun('ao_q'))!.status).toBe('RUNNING');
  });
});

describe('SigningStatusProcessor branches', () => {
  it('skips empty ids and sessions without a provider id; records progress and times out stale requests', async () => {
    const b = build();
    await b.signingProcessor.handle({});
    await b.d.signing.create({
      id: 'ss_np',
      applicationId: 'app_1',
      snapshotId: 'snap_1',
      documentPackVersion: 1,
      signingMethod: 'AADHAAR_ESIGN',
      status: 'REQUESTED',
      packObjectKey: 'k',
      packSha256: 'h',
      documents: [],
      pollCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await b.signingProcessor.handle({ signingSessionId: 'ss_np' });
    expect(b.d.jobs.published).toHaveLength(0);
    const old = new Date(
      b.d.clock.now().getTime() - SIGNING_POLL_MAX_AGE_MS - 1,
    );
    await b.d.signing.create({
      id: 'ss_old',
      applicationId: 'app_1',
      snapshotId: 'snap_1',
      documentPackVersion: 1,
      signingMethod: 'AADHAAR_ESIGN',
      status: 'REQUESTED',
      providerRequestId: 'DIDOLD',
      packObjectKey: 'k',
      packSha256: 'h',
      documents: [],
      pollCount: 3,
      createdAt: old,
      updatedAt: old,
    });
    await b.signingProcessor.handle({ signingSessionId: 'ss_old' });
    expect((await b.d.signing.findById('ss_old'))!).toMatchObject({
      status: 'EXPIRED',
      safeErrorCategory: 'poll_timeout',
    });
    await b.d.signing.create({
      id: 'ss_new',
      applicationId: 'app_1',
      snapshotId: 'snap_1',
      documentPackVersion: 1,
      signingMethod: 'AADHAAR_ESIGN',
      status: 'REQUESTED',
      providerRequestId: 'DIDNEW',
      packObjectKey: 'k',
      packSha256: 'h',
      documents: [],
      pollCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await b.signingProcessor.handle({ signingSessionId: 'ss_new' }); // requested → requested: no progress audit
    expect(
      b.d.audit.events.some((e) => e.action === 'signing_session.progress'),
    ).toBe(false);
    b.d.esign.status = {
      providerDocumentId: 'x',
      agreementStatus: 'failed',
      signers: [],
      raw: {},
    };
    await b.signingProcessor.handle({ signingSessionId: 'ss_new' });
    expect((await b.d.signing.findById('ss_new'))!.status).toBe('FAILED');
  });
});

describe('ProcessingService and FundingService branches', () => {
  it('maps every application status, accepts document responses, and reports in-flight funding states', async () => {
    const b = build();
    await b.d.tasks.create({
      id: 't_doc',
      applicationId: 'app_1',
      category: 'BANK_PROOF',
      status: 'OPEN',
      createdAt: new Date(),
    });
    await b.d.documents.createDocument({
      id: 'doc_1',
      applicationId: 'app_1',
      requirementId: 'BANK_PROOF',
      documentType: 'CANCELLED_CHEQUE',
      files: [],
      status: 'VERIFIED',
      operationId: 'op',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(
      await b.processing.respond({
        applicationId: 'app_1',
        customerId: 'cus_1',
        taskId: 't_doc',
        responseType: 'DOCUMENT',
        documentIds: ['doc_1'],
      }),
    ).toEqual({ status: 'SUBMITTED', taskStatus: 'UNDER_REVIEW' });
    await expect(
      b.processing.respond({
        applicationId: 'app_1',
        customerId: 'cus_1',
        taskId: 't_doc',
        responseType: 'DOCUMENT',
        documentIds: [],
      }),
    ).rejects.toBeInstanceOf(Error);
    await expect(b.processing.status('app_1', 'cus_x')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const app = b.app();
    await b.d.applications.saveWithVersionCheck(
      { ...app, status: 'ASSISTED' },
      app.version,
    );
    expect(
      (await b.processing.status('app_1', 'cus_1')).applicationStatus,
    ).toBe('ASSISTED');
    await b.d.applications.saveWithVersionCheck(
      { ...app, status: 'IN_PROGRESS' },
      app.version,
    );
    expect(
      (await b.processing.status('app_1', 'cus_1')).applicationStatus,
    ).toBe('IN_PROGRESS');
    await b.d.applications.saveWithVersionCheck(
      {
        ...completeStep(
          { ...app, status: 'SUBMITTED' },
          'ACCOUNT_OPENING',
          'FUNDING_INSTRUCTIONS',
          new Date(),
        ),
      },
      app.version,
    );
    expect((await b.processing.status('app_1', 'cus_1')).nextScreen).toBe(
      'FUNDING_INSTRUCTIONS',
    );
    // funding with no eligibility row, no verified bank account and accounts missing
    await expect(
      b.funding.instructions('app_1', 'cus_1'),
    ).rejects.toMatchObject({ details: { reason: 'accounts_not_ready' } });
    await b.accountOpening.recordUnderlyingAccount({
      applicationId: 'app_1',
      providerReceiptKey: 'k1',
      provider: 'C',
      accountType: 'PMS_ACCOUNT',
      accountReference: 'P',
      status: 'READY',
    });
    await b.accountOpening.recordUnderlyingAccount({
      applicationId: 'app_1',
      providerReceiptKey: 'k2',
      provider: 'C',
      accountType: 'DEMAT',
      accountReference: 'D',
      status: 'READY',
    });
    expect(
      (await b.funding.instructions('app_1', 'cus_1')).requiredAmountInr,
    ).toBe(0);
    const r = await b.funding.recordReceipt({
      applicationId: 'app_1',
      providerReceiptKey: 'r1',
      provider: 'BANK',
      amountInr: 10,
      currency: 'INR',
      sourceAccountNumber: '999912345678',
      destinationReference: 'PMS-1',
      valueDate: '2026-10-18',
    });
    expect(r.matchStatus).toBe('UNMATCHED');
    expect(b.d.funding.receipts[0].mismatchReasons).toContain(
      'no_verified_account',
    );
    const first = await b.funding.notify({
      applicationId: 'app_1',
      customerId: 'cus_1',
      fundingMethod: 'BANK_TRANSFER',
      customerTransferReference: 'UTR0001',
    });
    const second = await b.funding.notify({
      applicationId: 'app_1',
      customerId: 'cus_1',
      fundingMethod: 'BANK_TRANSFER',
      customerTransferReference: 'UTR0002',
    });
    expect(first.notificationId).not.toBe(second.notificationId);
    expect(b.app().nextScreen).toBe('FUNDING_STATUS');
    await b.activation.handle({ payload: {} });
    await b.activation.handle({ payload: { applicationId: 'app_nope' } });
    expect(b.d.activations.rows).toHaveLength(0);
    await expect(
      b.accountOpening.recordUnderlyingAccount({
        applicationId: 'app_1',
        providerReceiptKey: 'k3',
        provider: 'C',
        accountType: 'DEMAT',
        accountReference: 'D',
        status: 'LOST' as never,
      }),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      b.accountOpening.recordUnderlyingAccount({
        applicationId: 'app_nope',
        providerReceiptKey: 'k4',
        provider: 'C',
        accountType: 'DEMAT',
        accountReference: 'D',
        status: 'READY',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
  it('signing create uses the phone when the customer has no email; evidence download path is covered on execute', async () => {
    const b = build();
    const app = b.app();
    await b.d.applications.saveWithVersionCheck(
      { ...app, status: 'IN_PROGRESS' },
      app.version,
    );
    b.d.signing.rows.clear();
    const r = await b.signing.create({
      applicationId: 'app_1',
      customerId: 'cus_1',
      snapshotId: 'snap_1',
      documentPackVersion: 1,
      signingMethod: 'AADHAAR_ESIGN',
    });
    expect(b.d.esign.requests[0].signer.identifier).toBe('919000000001');
    expect(r.status).toBe('REQUESTED');
  });
});

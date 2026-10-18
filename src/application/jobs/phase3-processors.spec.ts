import {
  FakeAnalytics,
  FakeApplications,
  FakeAudit,
  FakeDocuments,
  FakeIdentities,
  FakeInbox,
  FakeJobs,
  FakeKycRecords,
  FakeKycSessions,
  FakeStorage,
  FakeTasks,
  FakeUow,
  FakeVerifications,
  FixedClock,
  SeqIds,
  silentLogger,
} from '../../../test/support/fakes';
import { CorrelationStore } from '../../common/correlation/correlation.store';
import {
  DependencyUnavailableError,
  PartnerRejectedError,
} from '../../common/errors/app-error';
import { loadDocumentRequirementsRulebook } from '../../domain/documents/document-requirements-rulebook';
import { loadIpvRulebook } from '../../domain/ipv/ipv-rulebook';
import { loadKycRelianceRulebook } from '../../domain/kyc/kyc-reliance-rulebook';
import {
  completeStep,
  newApplication,
} from '../../domain/onboarding/application';
import { toIsoDate } from '../../domain/shared/iso-date';
import { DigioWebhookService } from '../integrations/digio-webhook.service';
import {
  DigioWebhookProcessor,
  findKycRequestId,
} from './digio-webhook.processor';
import { DocumentProcessor } from './document.processor';
import { IpvProcessor } from './ipv.processor';
import { KycLookupProcessor } from './kyc-lookup.processor';
import {
  KycStatusPollProcessor,
  pollDelayMs,
} from './kyc-status-poll.processor';

function build() {
  const store = new CorrelationStore();
  const clock = new FixedClock();
  const now = clock.now();
  const d = {
    uow: new FakeUow(),
    applications: new FakeApplications(),
    identities: new FakeIdentities((p) => p),
    kyc: new FakeKycRecords(),
    sessions: new FakeKycSessions(),
    documents: new FakeDocuments(),
    verifications: new FakeVerifications(),
    tasks: new FakeTasks(),
    storage: new FakeStorage(),
    jobs: new FakeJobs(),
    inbox: new FakeInbox(),
    audit: new FakeAudit(),
    analytics: new FakeAnalytics(),
    clock,
    ids: new SeqIds(),
    kra: {
      checkPanStatus: jest.fn(),
      fetchDetails: jest.fn(),
      register: jest.fn(),
      downloadDocuments: jest.fn(),
    },
    digistudio: {
      createRequest: jest.fn(),
      getStatus: jest.fn(),
      downloadMedia: jest.fn(),
      regenerateAccessToken: jest.fn(),
    },
    face: { liveness: jest.fn(), faceMatch: jest.fn() },
  };
  const app = completeStep(
    completeStep(
      completeStep(
        newApplication('app_1', 'cus_1', now),
        'EMAIL_VERIFIED',
        'ELIGIBILITY',
        now,
      ),
      'ELIGIBILITY',
      'PAN_IDENTITY',
      now,
    ),
    'IDENTITY',
    'KYC_PROGRESS',
    now,
  );
  void d.applications.create(app);
  void d.identities.append({
    applicationId: 'app_1',
    version: 1,
    pan: 'ABCPE1234F',
    legalName: 'Vinod',
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
    status: 'PROCESSING',
    operationId: 'op_1',
    version: 0,
    updatedAt: now,
  });
  const lookup = new KycLookupProcessor(
    store,
    silentLogger as never,
    d.uow,
    d.applications,
    d.identities,
    d.kyc,
    d.kra,
    d.storage,
    d.audit,
    d.analytics,
    d.clock,
    loadKycRelianceRulebook(),
    loadIpvRulebook(),
  );
  const poll = new KycStatusPollProcessor(
    store,
    silentLogger as never,
    d.uow,
    d.applications,
    d.sessions,
    d.kyc,
    d.digistudio,
    d.storage,
    d.jobs,
    d.audit,
    d.analytics,
    d.clock,
  );
  const docs = new DocumentProcessor(
    store,
    silentLogger as never,
    d.uow,
    d.documents,
    d.storage,
    d.audit,
    d.analytics,
    d.clock,
    loadDocumentRequirementsRulebook(),
  );
  const ipv = new IpvProcessor(
    store,
    silentLogger as never,
    d.uow,
    d.applications,
    d.verifications,
    d.documents,
    d.tasks,
    d.face,
    d.storage,
    d.audit,
    d.analytics,
    d.clock,
    d.ids,
    loadIpvRulebook(),
  );
  const webhook = new DigioWebhookProcessor(
    store,
    silentLogger as never,
    d.inbox,
    d.sessions,
    d.jobs,
    d.audit,
  );
  const ingress = new DigioWebhookService(
    d.inbox,
    d.jobs,
    silentLogger as never,
  );
  return { d, lookup, poll, docs, ipv, webhook, ingress, now };
}
const lookupJob = (attemptsMade = 0, attempts = 5) =>
  ({ attemptsMade, opts: { attempts } }) as never;
const lookupData = {
  aggregateId: 'app_1',
  payload: { kycRecordId: 'kyc_1', identityVersion: 1, operationId: 'op_1' },
};

describe('KycLookupProcessor', () => {
  it('routes a validated KRA record to REUSE with an IPV exemption, stores evidence and advances the application', async () => {
    const { d, lookup } = build();
    d.kra.checkPanStatus.mockResolvedValue({
      statusCode: '007',
      status: 'Validated',
      raw: { s: 1 },
    });
    d.kra.fetchDetails.mockResolvedValue({
      name: 'VINOD',
      kyc: {
        statusCode: '007',
        status: 'Validated',
        statusDate: toIsoDate('2023-06-02'),
        ipvFlag: 'Y',
        internalReference: 'WEB',
      },
      correspondenceAddress: { city: 'FARIDABAD' },
      kraInfo: { kra: 'CVLKRA' },
      raw: { r: 1 },
    });
    await lookup.handle(lookupData, lookupJob());
    expect(d.kyc.rows.get('kyc_1')).toMatchObject({
      status: 'EXISTING_RECORD_AVAILABLE',
      route: 'REUSE',
      version: 1,
      ipvExemptionBasis: 'KRA_IPV_FLAG',
      summary: { name: 'VINOD', statusCode: '007', internalReference: 'WEB' },
    });
    expect(d.applications.rows.get('app_1')?.nextScreen).toBe('CONFIRM_KYC');
    expect([...d.storage.objects.keys()][0]).toMatch(
      /^applications\/app_1\/kyc\/kyc_1\/kra-/,
    );
    expect(d.analytics.events.map((e) => e.name)).toEqual([
      'Identity Verification Completed',
      'KYC Route Assigned',
      'Existing KYC Retrieval Completed',
    ]);
    expect(JSON.stringify(d.analytics.events)).not.toContain('ABCPE1234F');
    // redelivery is a no-op
    await lookup.handle(lookupData, lookupJob());
    expect(d.kra.checkPanStatus).toHaveBeenCalledTimes(1);
  });
  it('no record routes to FRESH; unknown codes to ASSISTED with application status ASSISTED', async () => {
    const { d, lookup } = build();
    d.kra.checkPanStatus.mockResolvedValue({ raw: {} });
    await lookup.handle(lookupData, lookupJob());
    expect(d.kyc.rows.get('kyc_1')).toMatchObject({
      status: 'NO_RECORD',
      route: 'FRESH',
    });
    expect(d.applications.rows.get('app_1')?.nextScreen).toBe('FRESH_KYC');
    expect(d.kra.fetchDetails).not.toHaveBeenCalled();
    const b = build();
    b.d.kra.checkPanStatus.mockResolvedValue({ statusCode: '099', raw: {} });
    b.d.kra.fetchDetails.mockResolvedValue({
      kyc: { statusCode: '099' },
      raw: {},
    });
    await b.lookup.handle(lookupData, lookupJob());
    expect(b.d.applications.rows.get('app_1')).toMatchObject({
      status: 'ASSISTED',
      nextScreen: 'ASSISTED_ONBOARDING',
    });
  });
  it('provider outage rethrows while retries remain, then records TECHNICAL_ERROR; rejections are technical errors immediately', async () => {
    const { d, lookup } = build();
    d.kra.checkPanStatus.mockRejectedValue(new DependencyUnavailableError());
    await expect(
      lookup.handle(lookupData, lookupJob(0, 3)),
    ).rejects.toBeInstanceOf(DependencyUnavailableError);
    expect(d.kyc.rows.get('kyc_1')?.status).toBe('PROCESSING');
    await lookup.handle(lookupData, lookupJob(2, 3));
    expect(d.kyc.rows.get('kyc_1')).toMatchObject({
      status: 'TECHNICAL_ERROR',
      safeErrorCategory: 'provider_unavailable',
    });
    expect(d.applications.rows.get('app_1')?.nextScreen).toBe('KYC_PROGRESS');
    const b = build();
    b.d.kra.checkPanStatus.mockRejectedValue(
      new PartnerRejectedError('digio', 'REQUEST_VALIDATION_FAILED'),
    );
    await b.lookup.handle(lookupData, lookupJob());
    expect(b.d.kyc.rows.get('kyc_1')).toMatchObject({
      status: 'TECHNICAL_ERROR',
      safeErrorCategory: 'provider_rejected',
    });
  });
});

describe('KycStatusPollProcessor', () => {
  const session = (now: Date) => ({
    id: 'ks_1',
    applicationId: 'app_1',
    provider: 'DIGIO' as const,
    providerRequestId: 'KID1',
    templateName: 'T',
    status: 'REQUESTED' as const,
    pollCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  it('requested with successful actions stays in progress and re-polls with backoff', async () => {
    const { d, poll, now } = build();
    await d.sessions.create(session(now));
    d.digistudio.getStatus.mockResolvedValue({
      providerRequestId: 'KID1',
      status: 'requested',
      actions: [{ status: 'success', processingDone: true }],
      raw: {},
    });
    await poll.handle({ payload: { sessionId: 'ks_1' } });
    expect(d.sessions.rows.get('ks_1')).toMatchObject({
      status: 'IN_PROGRESS',
      pollCount: 1,
      lastProviderStatus: 'requested',
    });
    expect(d.jobs.published[0]).toMatchObject({
      queue: 'kyc-status',
      name: 'poll',
      payload: { sessionId: 'ks_1' },
      opts: { jobId: 'ks_1-poll-1', delayMs: pollDelayMs(1) },
    });
    expect(d.kyc.rows.get('kyc_1')?.status).toBe('PROCESSING');
    expect(pollDelayMs(0)).toBe(30_000);
    expect(pollDelayMs(10)).toBe(15 * 60_000);
  });
  it('approved with a completed selfie action completes KYC and IPV', async () => {
    const { d, poll, now } = build();
    await d.sessions.create(session(now));
    d.digistudio.getStatus.mockResolvedValue({
      providerRequestId: 'KID1',
      status: 'approved',
      actions: [
        {
          type: 'selfie',
          status: 'success',
          processingDone: true,
          faceMatchStatus: 'done',
        },
      ],
      raw: {},
    });
    await poll.handle({ sessionId: 'ks_1' });
    expect(d.sessions.rows.get('ks_1')).toMatchObject({ status: 'COMPLETED' });
    expect(d.kyc.rows.get('kyc_1')).toMatchObject({
      status: 'COMPLETE',
      provider: 'DIGIO_STUDIO',
      ipvExemptionBasis: 'DIGISTUDIO_SELFIE',
    });
    expect(d.applications.rows.get('app_1')?.nextScreen).toBe('PROFILE');
    expect(d.jobs.published).toHaveLength(0);
    await poll.handle({ sessionId: 'ks_1' }); // terminal: no further provider calls
    expect(d.digistudio.getStatus).toHaveBeenCalledTimes(1);
  });
  it('rejected sessions send the customer back to FRESH_KYC; stale sessions expire', async () => {
    const { d, poll, now } = build();
    await d.sessions.create(session(now));
    d.digistudio.getStatus.mockResolvedValue({
      providerRequestId: 'KID1',
      status: 'rejected',
      actions: [],
      raw: {},
    });
    await poll.handle({ sessionId: 'ks_1' });
    expect(d.sessions.rows.get('ks_1')).toMatchObject({
      status: 'REJECTED',
      safeErrorCategory: 'provider_rejected',
    });
    expect(d.applications.rows.get('app_1')?.nextScreen).toBe('FRESH_KYC');
    const b = build();
    await b.d.sessions.create({
      ...session(b.now),
      id: 'ks_old',
      createdAt: new Date(b.now.getTime() - 25 * 3600 * 1000),
    });
    b.d.digistudio.getStatus.mockResolvedValue({
      providerRequestId: 'KID1',
      status: 'requested',
      actions: [],
      raw: {},
    });
    await b.poll.handle({ sessionId: 'ks_old' });
    expect(b.d.sessions.rows.get('ks_old')).toMatchObject({
      status: 'EXPIRED',
      safeErrorCategory: 'poll_timeout',
    });
    expect(b.d.jobs.published).toHaveLength(0);
  });
});

describe('KycStatusPollProcessor (more branches)', () => {
  const session = (now: Date) => ({
    id: 'ks_1',
    applicationId: 'app_1',
    provider: 'DIGIO' as const,
    providerRequestId: 'KID1',
    templateName: 'T',
    status: 'REQUESTED' as const,
    pollCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  it('approved without a selfie action completes KYC but routes to IPV; approval_pending keeps polling; missing provider id is ignored', async () => {
    const { d, poll, now } = build();
    await d.sessions.create(session(now));
    d.digistudio.getStatus.mockResolvedValue({
      providerRequestId: 'KID1',
      status: 'approved',
      actions: [{ type: 'image', status: 'success', processingDone: true }],
      raw: {},
    });
    await poll.handle({ sessionId: 'ks_1' });
    expect(d.kyc.rows.get('kyc_1')).toMatchObject({
      status: 'COMPLETE',
      ipvExemptionBasis: undefined,
    });
    expect(d.applications.rows.get('app_1')?.nextScreen).toBe('IPV');
    const b = build();
    await b.d.sessions.create(session(b.now));
    b.d.digistudio.getStatus.mockResolvedValue({
      providerRequestId: 'KID1',
      status: 'approval_pending',
      actions: [],
      raw: {},
    });
    await b.poll.handle({ sessionId: 'ks_1' });
    expect(b.d.sessions.rows.get('ks_1')?.status).toBe('APPROVAL_PENDING');
    expect(b.d.jobs.published).toHaveLength(1);
    const c = build();
    await c.d.sessions.create({
      ...session(c.now),
      providerRequestId: undefined,
    });
    await c.poll.handle({ sessionId: 'ks_1' });
    await c.poll.handle({});
    expect(c.d.digistudio.getStatus).not.toHaveBeenCalled();
  });
});

describe('DigioWebhookProcessor (failure path)', () => {
  it('marks the inbox row failed and rethrows when processing throws', async () => {
    const { d, ingress, webhook } = build();
    await ingress.receive(
      { id: 'evt_x', payload: { kyc_request: { id: 'KID1' } } },
      'raw',
    );
    jest
      .spyOn(d.sessions, 'findByProviderRequestId')
      .mockRejectedValueOnce(new Error('db down'));
    await expect(webhook.handle({ inboxId: 'inbox_1' })).rejects.toThrow(
      'db down',
    );
    expect(d.inbox.rows.get('inbox_1')?.status).toBe('FAILED');
    await d.inbox.markProcessed('inbox_1');
    await webhook.handle({ inboxId: 'inbox_1' }); // already processed: no-op
  });
});

describe('DocumentProcessor', () => {
  const doc = (now: Date) => ({
    id: 'doc_1',
    applicationId: 'app_1',
    requirementId: 'ADDRESS_PROOF',
    documentType: 'PASSPORT',
    files: [{ uploadId: 'u1', side: 'PHOTO_PAGE', objectKey: 'k1' }],
    status: 'PROCESSING' as const,
    operationId: 'op',
    createdAt: now,
    updatedAt: now,
  });
  const upload = (now: Date, ct: string) => ({
    id: 'u1',
    applicationId: 'app_1',
    requirementId: 'ADDRESS_PROOF',
    objectKey: 'k1',
    declaredContentType: ct,
    declaredSizeBytes: 3,
    status: 'CONSUMED' as const,
    expiresAt: now,
    createdAt: now,
  });
  it('verifies a real jpeg with checksum', async () => {
    const { d, docs, now } = build();
    await d.documents.createDocument(doc(now));
    await d.documents.createUpload(upload(now, 'image/jpeg'));
    await d.storage.put(
      'k1',
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      'image/jpeg',
    );
    await docs.handle({ payload: { documentId: 'doc_1' } });
    expect(d.documents.docs.get('doc_1')).toMatchObject({
      status: 'VERIFIED',
      files: [
        {
          contentType: 'image/jpeg',
          sizeBytes: 4,
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/) as string,
        },
      ],
    });
    expect(d.analytics.events[0]).toMatchObject({
      name: 'Document Processing Completed',
      outcome: 'verified',
    });
  });
  it('rejects a declared pdf whose bytes are png, oversize files, and missing objects', async () => {
    const { d, docs, now } = build();
    await d.documents.createDocument(doc(now));
    await d.documents.createUpload(upload(now, 'application/pdf'));
    await d.storage.put(
      'k1',
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]),
      'application/pdf',
    );
    await docs.handle({ payload: { documentId: 'doc_1' } });
    expect(d.documents.docs.get('doc_1')).toMatchObject({
      status: 'REJECTED',
      safeErrorCategory: 'content_type_mismatch',
    });
    const b = build();
    await b.d.documents.createDocument(doc(b.now));
    await b.d.documents.createUpload(upload(b.now, 'image/jpeg'));
    await b.d.storage.put(
      'k1',
      Buffer.alloc(10 * 1024 * 1024 + 1, 1),
      'image/jpeg',
    );
    await b.docs.handle({ payload: { documentId: 'doc_1' } });
    expect(b.d.documents.docs.get('doc_1')).toMatchObject({
      status: 'REJECTED',
      safeErrorCategory: 'too_large',
    });
    const c = build();
    await c.d.documents.createDocument(doc(c.now));
    await c.docs.handle({ payload: { documentId: 'doc_1' } });
    expect(c.d.documents.docs.get('doc_1')).toMatchObject({
      status: 'REJECTED',
      safeErrorCategory: 'missing_object',
    });
    await c.docs.handle({ payload: { documentId: 'doc_1' } }); // idempotent
    expect(c.d.analytics.events).toHaveLength(1);
  });
});

describe('IpvProcessor', () => {
  function seed(b: ReturnType<typeof build>, withReference = true) {
    const now = b.now;
    void b.d.documents.createDocument({
      id: 'doc_selfie',
      applicationId: 'app_1',
      requirementId: 'SELFIE',
      documentType: 'SELFIE',
      files: [
        {
          uploadId: 'u',
          side: 'PHOTO',
          objectKey: 'selfie',
          contentType: 'image/jpeg',
        },
      ],
      status: 'VERIFIED',
      operationId: 'op',
      createdAt: now,
      updatedAt: now,
    });
    if (withReference)
      void b.d.documents.createDocument({
        id: 'doc_id',
        applicationId: 'app_1',
        requirementId: 'IDENTITY_PROOF',
        documentType: 'PASSPORT',
        files: [
          {
            uploadId: 'u2',
            side: 'PHOTO_PAGE',
            objectKey: 'idproof',
            contentType: 'image/jpeg',
          },
        ],
        status: 'VERIFIED',
        operationId: 'op',
        createdAt: now,
        updatedAt: now,
      });
    void b.d.storage.put('selfie', Buffer.from('s'), 'image/jpeg');
    void b.d.storage.put('idproof', Buffer.from('i'), 'image/jpeg');
    void b.d.verifications.create({
      id: 'av_1',
      applicationId: 'app_1',
      type: 'SELFIE_LIVENESS',
      status: 'REQUESTED',
      selfieDocumentId: 'doc_selfie',
      referenceDocumentId: withReference ? 'doc_id' : undefined,
      thresholdVersion: 'ipv_v1',
      createdAt: now,
      updatedAt: now,
    });
  }
  it('passes with live selfie and matching face, completing the IPV step', async () => {
    const b = build();
    seed(b);
    b.d.face.liveness.mockResolvedValue({
      result: 'PASS',
      score: 92,
      errors: [],
      raw: {},
    });
    b.d.face.faceMatch.mockResolvedValue({
      matchResult: 'matched',
      confidence: 88,
      raw: {},
    });
    await b.ipv.handle({ payload: { verificationId: 'av_1' } });
    expect(b.d.verifications.rows.get('av_1')).toMatchObject({
      status: 'PASSED',
      livenessScore: 92,
      faceMatchConfidence: 88,
    });
    expect(b.d.applications.rows.get('app_1')?.nextScreen).toBe('PROFILE');
    expect(b.d.face.faceMatch).toHaveBeenCalledWith(
      Buffer.from('s'),
      Buffer.from('i'),
      'image/jpeg',
      80,
      'av_1-m',
    );
  });
  it('fails on spoofed selfie and keeps the customer on IPV; review after exhausted attempts or no reference', async () => {
    const b = build();
    seed(b);
    b.d.face.liveness.mockResolvedValue({
      result: 'FAIL',
      score: 10,
      errors: ['Photo of photo detected'],
      raw: {},
    });
    await b.ipv.handle({ payload: { verificationId: 'av_1' } });
    expect(b.d.verifications.rows.get('av_1')).toMatchObject({
      status: 'FAILED',
      safeErrorCategory: 'liveness_failed',
    });
    expect(b.d.applications.rows.get('app_1')?.nextScreen).toBe('IPV');
    expect(b.d.face.faceMatch).not.toHaveBeenCalled();
    const c = build();
    seed(c, false);
    c.d.face.liveness.mockResolvedValue({
      result: 'PASS',
      score: 95,
      errors: [],
      raw: {},
    });
    await c.ipv.handle({ payload: { verificationId: 'av_1' } });
    expect(c.d.verifications.rows.get('av_1')).toMatchObject({
      status: 'REVIEW_REQUIRED',
      safeErrorCategory: 'no_reference_image',
    });
    expect(c.d.applications.rows.get('app_1')?.nextScreen).toBe(
      'ASSISTED_ONBOARDING',
    );
    expect(c.d.tasks.rows[0]).toMatchObject({ category: 'IPV_REVIEW' });
  });
});

describe('Digio webhook ingress and processing', () => {
  it('dedupes by notification id, acknowledges, and triggers an immediate poll for a known session', async () => {
    const { d, ingress, webhook, now } = build();
    await d.sessions.create({
      id: 'ks_1',
      applicationId: 'app_1',
      provider: 'DIGIO',
      providerRequestId: 'KID1',
      templateName: 'T',
      status: 'IN_PROGRESS',
      pollCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    const body = {
      id: 'evt_1',
      event: 'KYC.REQUEST.APPROVED',
      entities: ['kyc_request'],
      payload: { kyc_request: { id: 'KID1', status: 'approved' } },
    };
    expect(await ingress.receive(body, JSON.stringify(body))).toEqual({
      received: true,
      duplicate: false,
    });
    expect(await ingress.receive(body, JSON.stringify(body))).toEqual({
      received: true,
      duplicate: true,
    });
    expect(d.jobs.published).toHaveLength(1);
    expect(d.jobs.published[0]).toMatchObject({
      queue: 'webhook-processing',
      name: 'digio',
      opts: { jobId: 'inbox-inbox_1' },
    });
    await webhook.handle({ inboxId: 'inbox_1' });
    expect(d.jobs.published[1]).toMatchObject({
      queue: 'kyc-status',
      name: 'poll',
      payload: { sessionId: 'ks_1' },
    });
    expect(d.inbox.rows.get('inbox_1')?.status).toBe('PROCESSED');
    expect(d.kyc.rows.get('kyc_1')?.status).toBe('PROCESSING'); // payload never completes KYC by itself
    expect(
      findKycRequestId({ payload: { x: { id: 'nope' } } }),
    ).toBeUndefined();
  });
  it('events without an id are keyed by body hash; unknown sessions and kra events are processed without side effects', async () => {
    const { d, ingress, webhook } = build();
    await ingress.receive(
      {
        event: 'KRA.PAN.STATUS.UPDATE',
        entities: ['kra_register'],
        payload: { kra_register: { id: 'KRA1', status: 'KRA_VERIFIED' } },
      },
      'raw-1',
    );
    await ingress.receive(
      { event: 'X', payload: { kyc_request: { id: 'KID_unknown' } } },
      'raw-2',
    );
    await webhook.handle({ inboxId: 'inbox_1' });
    await webhook.handle({ inboxId: 'inbox_2' });
    await webhook.handle({ inboxId: 'inbox_404' });
    expect([...d.inbox.rows.values()].map((r) => r.status)).toEqual([
      'PROCESSED',
      'PROCESSED',
    ]);
    expect(
      d.jobs.published.filter((j) => j.queue === 'kyc-status'),
    ).toHaveLength(0);
  });
});

import {
  FakeAnalytics,
  FakeApplications,
  FakeAudit,
  FakeCustomers,
  FakeDocuments,
  FakeIdentities,
  FakeKycRecords,
  FakeKycSessions,
  FakeOutbox,
  FakeStorage,
  FakeTasks,
  FakeUow,
  FakeVerifications,
  FixedClock,
  SeqIds,
} from '../../../test/support/fakes';
import { Fingerprint } from '../../common/crypto/fingerprint';
import {
  NotFoundError,
  StaleVersionError,
  ValidationError,
} from '../../common/errors/app-error';
import { loadDocumentRequirementsRulebook } from '../../domain/documents/document-requirements-rulebook';
import {
  newProvisionalCustomer,
  verifyPhone,
} from '../../domain/identity/customer';
import { loadIpvRulebook } from '../../domain/ipv/ipv-rulebook';
import {
  completeStep,
  newApplication,
} from '../../domain/onboarding/application';
import { normalisePhone } from '../../domain/shared/phone-number';
import { DocumentService } from '../documents/document.service';
import { AdditionalVerificationService } from './additional-verification.service';
import { IdentityService } from './identity.service';
import { KycConfirmationService } from './kyc-confirmation.service';
import { KycQueryService } from './kyc-query.service';
import { KycSessionService } from './kyc-session.service';

function build() {
  const fingerprint = new Fingerprint({
    fingerprintKeyBase64: Buffer.alloc(32, 2).toString('base64'),
  });
  const clock = new FixedClock();
  const now = clock.now();
  const d = {
    uow: new FakeUow(),
    applications: new FakeApplications(),
    customers: new FakeCustomers((p) => fingerprint.of(p, 'phone')),
    identities: new FakeIdentities((p) => fingerprint.of(p, 'pan')),
    kyc: new FakeKycRecords(),
    sessions: new FakeKycSessions(),
    documents: new FakeDocuments(),
    verifications: new FakeVerifications(),
    tasks: new FakeTasks(),
    storage: new FakeStorage(),
    audit: new FakeAudit(),
    outbox: new FakeOutbox(),
    analytics: new FakeAnalytics(),
    clock,
    ids: new SeqIds(),
    digistudio: {
      createRequest: jest.fn(),
      getStatus: jest.fn(),
      downloadMedia: jest.fn(),
      regenerateAccessToken: jest.fn(),
    },
  };
  const eligible = completeStep(
    completeStep(
      newApplication('app_1', 'cus_1', now),
      'EMAIL_VERIFIED',
      'ELIGIBILITY',
      now,
    ),
    'ELIGIBILITY',
    'PAN_IDENTITY',
    now,
  );
  void d.applications.create(eligible);
  void d.applications.create(newApplication('app_2', 'cus_2', now));
  void d.customers.create(
    verifyPhone(
      newProvisionalCustomer('cus_1', normalisePhone('9000000001'), now),
      now,
    ),
  );
  const identity = new IdentityService(
    d.uow,
    d.applications,
    d.identities,
    d.kyc,
    d.tasks,
    d.audit,
    d.outbox,
    d.analytics,
    d.clock,
    d.ids,
    fingerprint,
  );
  const query = new KycQueryService(d.applications, d.kyc);
  const confirmation = new KycConfirmationService(
    d.uow,
    d.applications,
    d.kyc,
    d.audit,
    d.outbox,
    d.analytics,
    d.clock,
  );
  const sessions = new KycSessionService(
    d.uow,
    d.applications,
    d.customers,
    d.kyc,
    d.sessions,
    d.digistudio,
    d.storage,
    d.audit,
    d.outbox,
    d.analytics,
    d.clock,
    d.ids,
    { digio: { kycTemplateName: 'PMS_KYC_TEST' } } as never,
  );
  const documents = new DocumentService(
    d.uow,
    d.applications,
    d.documents,
    d.storage,
    d.audit,
    d.outbox,
    d.clock,
    d.ids,
    loadDocumentRequirementsRulebook(),
    { uploadUrlTtlSeconds: 300 },
  );
  const ipv = new AdditionalVerificationService(
    d.uow,
    d.applications,
    d.kyc,
    d.documents,
    d.verifications,
    d.tasks,
    d.audit,
    d.outbox,
    d.analytics,
    d.clock,
    d.ids,
    loadIpvRulebook(),
  );
  return { d, identity, query, confirmation, sessions, documents, ipv, now };
}
const submit = {
  applicationId: 'app_1',
  customerId: 'cus_1',
  pan: 'abcpe1234f',
  legalName: 'Vinod Kumar',
  dateOfBirth: '1990-01-15',
  permissionVersion: 'kyc_fetch_v1',
};

describe('IdentityService', () => {
  it('records the identity version, a PROCESSING kyc record, advances to PORTFOLIO_IMPORT (screen 06A) and enqueues the lookup', async () => {
    const { d, identity } = build();
    const r = await identity.submit(submit);
    expect(r).toEqual({
      operationId: expect.stringMatching(/^op_/) as string,
      status: 'PROCESSING',
      nextScreen: 'PORTFOLIO_IMPORT',
    });
    expect(d.identities.rows[0]).toMatchObject({
      applicationId: 'app_1',
      version: 1,
      pan: 'ABCPE1234F',
      legalName: 'Vinod Kumar',
      status: 'SUBMITTED',
    });
    expect([...d.kyc.rows.values()][0]).toMatchObject({
      status: 'PROCESSING',
      identityVersion: 1,
    });
    expect(d.applications.rows.get('app_1')).toMatchObject({
      nextScreen: 'PORTFOLIO_IMPORT',
    });
    expect(d.outbox.events.map((e) => e.eventType)).toEqual([
      'IdentityVerificationRequested',
    ]);
    expect(
      JSON.stringify(d.analytics.events) + JSON.stringify(d.outbox.events),
    ).not.toContain('ABCPE1234F');
  });
  it('a PAN already used by another application is routed to review with an identical response and no provider job', async () => {
    const { d, identity } = build();
    d.identities.rows.push({
      applicationId: 'app_other',
      version: 1,
      pan: 'ABCPE1234F',
      legalName: 'X',
      dateOfBirth: '1980-01-01' as never,
      permissionVersion: 'v',
      status: 'SUBMITTED',
      submittedAt: new Date(),
    });
    const r = await identity.submit(submit);
    expect(r).toMatchObject({
      status: 'PROCESSING',
      nextScreen: 'PORTFOLIO_IMPORT',
    });
    expect([...d.kyc.rows.values()][0]).toMatchObject({
      status: 'REVIEW_REQUIRED',
      route: 'ASSISTED',
      safeErrorCategory: 'duplicate_identity',
    });
    expect(d.outbox.events).toHaveLength(0);
    expect(d.tasks.rows[0]).toMatchObject({
      category: 'IDENTITY_DUPLICATE_REVIEW',
    });
  });
  it('validates inputs and prerequisites', async () => {
    const { d, identity } = build();
    await expect(
      identity.submit({ ...submit, pan: 'ABCCE1234F' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      identity.submit({ ...submit, dateOfBirth: '2020-01-01' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      identity.submit({ ...submit, dateOfBirth: '15/01/1990' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      identity.submit({ ...submit, permissionVersion: '' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      identity.submit({ ...submit, applicationId: 'app_2' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    d.applications.rows.set('app_2', {
      ...d.applications.rows.get('app_2')!,
      customerId: 'cus_1',
    });
    await expect(
      identity.submit({ ...submit, applicationId: 'app_2' }),
    ).rejects.toBeInstanceOf(ValidationError); // eligibility not done
    expect(d.identities.rows).toHaveLength(0);
  });
});

describe('KycQueryService and KycConfirmationService', () => {
  it('query is 422 before identity, then reflects the record; confirmation handles stale, remediation and completion', async () => {
    const { d, identity, query, confirmation } = build();
    await expect(query.get('app_1', 'cus_1')).rejects.toBeInstanceOf(
      ValidationError,
    );
    await identity.submit(submit);
    expect(await query.get('app_1', 'cus_1')).toMatchObject({
      status: 'PROCESSING',
      nextScreen: 'KYC_PROGRESS',
      recordVersion: 0,
    });
    const rec = [...d.kyc.rows.values()][0];
    d.kyc.rows.set(rec.id, {
      ...rec,
      status: 'EXISTING_RECORD_AVAILABLE',
      route: 'REUSE',
      version: 1,
      summary: { name: 'VINOD', correspondenceAddress: { city: 'FARIDABAD' } },
      ipvExemptionBasis: 'KRA_IPV_FLAG',
    });
    expect(await query.get('app_1', 'cus_1')).toMatchObject({
      status: 'EXISTING_RECORD_AVAILABLE',
      route: 'REUSE',
      nextScreen: 'CONFIRM_KYC',
      details: { legalName: 'VINOD', address: { city: 'FARIDABAD' } },
    });
    await expect(query.get('app_1', 'cus_9')).rejects.toBeInstanceOf(
      NotFoundError,
    );

    await expect(
      confirmation.confirm({
        applicationId: 'app_1',
        customerId: 'cus_1',
        kycRecordVersion: 0,
        detailsConfirmed: true,
        changes: {},
      }),
    ).rejects.toBeInstanceOf(StaleVersionError);
    const rem = await confirmation.confirm({
      applicationId: 'app_1',
      customerId: 'cus_1',
      kycRecordVersion: 1,
      detailsConfirmed: true,
      changes: { address: 'new' },
    });
    expect(rem).toEqual({
      status: 'REMEDIATION_REQUIRED',
      kycStatus: 'REMEDIATE',
      nextScreen: 'FRESH_KYC',
    });
    expect(d.kyc.rows.get(rec.id)).toMatchObject({
      route: 'REMEDIATE',
      version: 2,
    });
    await expect(
      confirmation.confirm({
        applicationId: 'app_1',
        customerId: 'cus_1',
        kycRecordVersion: 2,
        detailsConfirmed: true,
        changes: {},
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    d.kyc.rows.set(rec.id, { ...d.kyc.rows.get(rec.id)!, route: 'REUSE' });
    const ok = await confirmation.confirm({
      applicationId: 'app_1',
      customerId: 'cus_1',
      kycRecordVersion: 2,
      detailsConfirmed: true,
      changes: {},
    });
    expect(ok).toEqual({
      status: 'CONFIRMED',
      kycStatus: 'COMPLETE',
      nextScreen: 'PROFILE',
    });
    expect(d.kyc.rows.get(rec.id)).toMatchObject({
      status: 'COMPLETE',
      version: 3,
    });
    const app = d.applications.rows.get('app_1')!;
    expect(app.nextScreen).toBe('PROFILE');
    expect(app.steps.map((s) => s.stepId)).toEqual(
      expect.arrayContaining(['KYC', 'IPV']),
    );
    expect(d.analytics.events.map((e) => e.name)).toEqual(
      expect.arrayContaining(['KYC Details Confirmed', 'KYC Completed']),
    );
  });
  it('without an IPV exemption, confirmation goes to the IPV screen', async () => {
    const { d, identity, confirmation } = build();
    await identity.submit(submit);
    const rec = [...d.kyc.rows.values()][0];
    d.kyc.rows.set(rec.id, {
      ...rec,
      status: 'EXISTING_RECORD_AVAILABLE',
      route: 'REUSE',
      version: 1,
    });
    expect(
      await confirmation.confirm({
        applicationId: 'app_1',
        customerId: 'cus_1',
        kycRecordVersion: 1,
        detailsConfirmed: true,
        changes: {},
      }),
    ).toMatchObject({ nextScreen: 'IPV' });
  });
});

describe('KycSessionService', () => {
  it('creates a DigiStudio request with the configured template and resumes an active one with a fresh token', async () => {
    const { d, identity, sessions } = build();
    await identity.submit(submit);
    const rec = [...d.kyc.rows.values()][0];
    await expect(
      sessions.create({
        applicationId: 'app_1',
        customerId: 'cus_1',
        method: 'DIGITAL_DOCUMENTS',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    d.kyc.rows.set(rec.id, {
      ...rec,
      status: 'NO_RECORD',
      route: 'FRESH',
      version: 1,
    });
    d.digistudio.createRequest.mockResolvedValue({
      providerRequestId: 'KID1',
      status: 'requested',
      accessToken: { id: 'GWT1' },
      raw: { id: 'KID1' },
    });
    const r = await sessions.create({
      applicationId: 'app_1',
      customerId: 'cus_1',
      method: 'DIGITAL_DOCUMENTS',
    });
    expect(r).toMatchObject({
      status: 'REQUESTED',
      provider: 'DIGIO',
      providerRequestId: 'KID1',
      sdkLaunch: { accessToken: 'GWT1' },
      nextScreen: 'PROVIDER_KYC',
    });
    expect(d.digistudio.createRequest).toHaveBeenCalledWith({
      customerIdentifier: '919000000001',
      referenceId: 'app_1',
      transactionId: r.sessionId,
      templateName: 'PMS_KYC_TEST',
    });
    expect(d.applications.rows.get('app_1')?.nextScreen).toBe('PROVIDER_KYC');
    expect(d.outbox.events.map((e) => e.eventType)).toContain(
      'KycSessionCreated',
    );
    expect([...d.storage.objects.keys()][0]).toMatch(
      /kyc-sessions\/.*\/create\.json$/,
    );
    d.digistudio.regenerateAccessToken.mockResolvedValue({ id: 'GWT2' });
    const again = await sessions.create({
      applicationId: 'app_1',
      customerId: 'cus_1',
      method: 'DIGITAL_DOCUMENTS',
    });
    expect(again).toMatchObject({
      sessionId: r.sessionId,
      sdkLaunch: { accessToken: 'GWT2' },
    });
    expect(d.digistudio.createRequest).toHaveBeenCalledTimes(1);
  });
  it('fails safely when the provider does not return an SDK token', async () => {
    const { d, identity, sessions } = build();
    await identity.submit(submit);
    const rec = [...d.kyc.rows.values()][0];
    d.kyc.rows.set(rec.id, {
      ...rec,
      status: 'EXISTING_RECORD_AVAILABLE',
      route: 'REMEDIATE',
      version: 1,
    });
    d.digistudio.createRequest.mockResolvedValue({
      providerRequestId: 'KID1',
      status: 'requested',
      raw: {},
    });
    await expect(
      sessions.create({
        applicationId: 'app_1',
        customerId: 'cus_1',
        method: 'DIGITAL_DOCUMENTS',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('DocumentService', () => {
  it('authorises uploads within the rulebook and registers documents only for uploaded, matching files', async () => {
    const { d, documents } = build();
    await expect(
      documents.authoriseUpload({
        applicationId: 'app_1',
        customerId: 'cus_1',
        requirementId: 'NOPE',
        contentType: 'image/jpeg',
        sizeBytes: 10,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      documents.authoriseUpload({
        applicationId: 'app_1',
        customerId: 'cus_1',
        requirementId: 'ADDRESS_PROOF',
        contentType: 'application/zip',
        sizeBytes: 10,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const a = await documents.authoriseUpload({
      applicationId: 'app_1',
      customerId: 'cus_1',
      requirementId: 'ADDRESS_PROOF',
      contentType: 'image/jpeg',
      sizeBytes: 10,
    });
    const b = await documents.authoriseUpload({
      applicationId: 'app_1',
      customerId: 'cus_1',
      requirementId: 'ADDRESS_PROOF',
      contentType: 'image/jpeg',
      sizeBytes: 10,
    });
    expect(a).toMatchObject({ expiresInSeconds: 300 });
    expect(a.uploadUrl).toContain('image%2Fjpeg');
    const files = [
      { uploadId: a.uploadId, side: 'PHOTO_PAGE' },
      { uploadId: b.uploadId, side: 'ADDRESS_PAGE' },
    ];
    await expect(
      documents.submit({
        applicationId: 'app_1',
        customerId: 'cus_1',
        requirementId: 'ADDRESS_PROOF',
        documentType: 'PASSPORT',
        files,
      }),
    ).rejects.toMatchObject({ details: { reason: 'not_uploaded' } });
    for (const u of d.documents.uploads.values())
      await d.storage.put(
        u.objectKey,
        Buffer.from([0xff, 0xd8, 0xff]),
        'image/jpeg',
      );
    const r = await documents.submit({
      applicationId: 'app_1',
      customerId: 'cus_1',
      requirementId: 'ADDRESS_PROOF',
      documentType: 'PASSPORT',
      files,
    });
    expect(r).toMatchObject({ status: 'PROCESSING' });
    expect(d.outbox.events.map((e) => e.eventType)).toEqual([
      'DocumentSubmitted',
    ]);
    expect(
      [...d.documents.uploads.values()].every((u) => u.status === 'CONSUMED'),
    ).toBe(true);
    await expect(
      documents.submit({
        applicationId: 'app_1',
        customerId: 'cus_1',
        requirementId: 'ADDRESS_PROOF',
        documentType: 'PASSPORT',
        files,
      }),
    ).rejects.toMatchObject({ details: { reason: 'upload_not_usable' } });
    await expect(
      documents.submit({
        applicationId: 'app_2',
        customerId: 'cus_1',
        requirementId: 'ADDRESS_PROOF',
        documentType: 'PASSPORT',
        files,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('AdditionalVerificationService', () => {
  async function withCompleteKyc(exempt: boolean) {
    const b = build();
    await b.identity.submit(submit);
    const rec = [...b.d.kyc.rows.values()][0];
    b.d.kyc.rows.set(rec.id, {
      ...rec,
      status: 'COMPLETE',
      route: 'REUSE',
      version: 1,
      ipvExemptionBasis: exempt ? 'KRA_IPV_FLAG' : undefined,
    });
    return b;
  }
  it('requires completed KYC; exempt records complete IPV immediately', async () => {
    const { ipv } = build();
    await expect(
      ipv.request({
        applicationId: 'app_1',
        customerId: 'cus_1',
        verificationType: 'SELFIE_LIVENESS',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const { d, ipv: ipv2 } = await withCompleteKyc(true);
    const r = await ipv2.request({
      applicationId: 'app_1',
      customerId: 'cus_1',
      verificationType: 'SELFIE_LIVENESS',
    });
    expect(r).toMatchObject({ status: 'EXEMPT', nextScreen: 'PROFILE' });
    expect(d.applications.rows.get('app_1')?.nextScreen).toBe('PROFILE');
  });
  it('selfie liveness needs a verified selfie document and enqueues the job; attempts are capped', async () => {
    const { d, ipv } = await withCompleteKyc(false);
    await expect(
      ipv.request({
        applicationId: 'app_1',
        customerId: 'cus_1',
        verificationType: 'SELFIE_LIVENESS',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const now = new Date();
    void d.documents.createDocument({
      id: 'doc_selfie',
      applicationId: 'app_1',
      requirementId: 'SELFIE',
      documentType: 'SELFIE',
      files: [{ uploadId: 'u', side: 'PHOTO', objectKey: 'k' }],
      status: 'VERIFIED',
      operationId: 'op',
      createdAt: now,
      updatedAt: now,
    });
    void d.documents.createDocument({
      id: 'doc_id',
      applicationId: 'app_1',
      requirementId: 'IDENTITY_PROOF',
      documentType: 'PASSPORT',
      files: [{ uploadId: 'u2', side: 'PHOTO_PAGE', objectKey: 'k2' }],
      status: 'VERIFIED',
      operationId: 'op',
      createdAt: now,
      updatedAt: now,
    });
    const r = await ipv.request({
      applicationId: 'app_1',
      customerId: 'cus_1',
      verificationType: 'SELFIE_LIVENESS',
      selfieDocumentId: 'doc_selfie',
    });
    expect(r).toMatchObject({ status: 'REQUESTED', nextScreen: 'IPV' });
    expect([...d.verifications.rows.values()][0]).toMatchObject({
      selfieDocumentId: 'doc_selfie',
      referenceDocumentId: 'doc_id',
    });
    expect(d.outbox.events.map((e) => e.eventType)).toContain(
      'AdditionalVerificationRequested',
    );
    for (let i = 0; i < 2; i++)
      await ipv.request({
        applicationId: 'app_1',
        customerId: 'cus_1',
        verificationType: 'SELFIE_LIVENESS',
        selfieDocumentId: 'doc_selfie',
      });
    await expect(
      ipv.request({
        applicationId: 'app_1',
        customerId: 'cus_1',
        verificationType: 'SELFIE_LIVENESS',
        selfieDocumentId: 'doc_selfie',
      }),
    ).rejects.toMatchObject({ details: { reason: 'max_attempts' } });
  });
  it('assisted IPV opens a task and routes to assisted onboarding', async () => {
    const { d, ipv } = await withCompleteKyc(false);
    const r = await ipv.request({
      applicationId: 'app_1',
      customerId: 'cus_1',
      verificationType: 'ASSISTED_IPV',
    });
    expect(r).toMatchObject({
      status: 'REVIEW_REQUIRED',
      nextScreen: 'ASSISTED_ONBOARDING',
    });
    expect(d.tasks.rows[0]).toMatchObject({
      category: 'IPV_ASSISTED',
      status: 'OPEN',
    });
  });
});

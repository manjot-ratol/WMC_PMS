import { randomUUID } from 'node:crypto';
import { FieldCipher } from '../../../common/crypto/field-cipher';
import { Fingerprint } from '../../../common/crypto/fingerprint';
import { StaleVersionError } from '../../../common/errors/app-error';
import { toIsoDate } from '../../../domain/shared/iso-date';
import {
  describeWithDb,
  loadTestEnv,
  migrateTestDb,
} from '../../../../test/support/db';
import { PrismaService } from '../prisma.service';
import { DocumentRepository } from './document.repository';
import { IdentityRepository } from './identity.repository';
import { KycRecordRepository, KycSessionRepository } from './kyc.repository';
import {
  TaskRepository,
  VerificationRepository,
} from './verification.repository';

describeWithDb('Phase 3 repositories (docker postgres)', () => {
  let prisma: PrismaService;
  let identities: IdentityRepository;
  let records: KycRecordRepository;
  let sessions: KycSessionRepository;
  let documents: DocumentRepository;
  let verifications: VerificationRepository;
  let tasks: TaskRepository;
  const ns = randomUUID().slice(0, 8);
  const app = `app_${ns}`;
  const now = new Date('2026-10-18T00:00:00Z');
  let fp: Fingerprint;

  beforeAll(async () => {
    loadTestEnv();
    migrateTestDb();
    prisma = new PrismaService({ url: process.env.DATABASE_URL! });
    await prisma.onModuleInit();
    const cipher = new FieldCipher({
      fieldKeyId: 'k1',
      fieldKeyBase64: process.env.FIELD_ENCRYPTION_KEY!,
    });
    fp = new Fingerprint({
      fingerprintKeyBase64: process.env.FINGERPRINT_HMAC_KEY!,
    });
    identities = new IdentityRepository(prisma, cipher, fp);
    records = new KycRecordRepository(prisma);
    sessions = new KycSessionRepository(prisma);
    documents = new DocumentRepository(prisma);
    verifications = new VerificationRepository(prisma);
    tasks = new TaskRepository(prisma);
  });
  afterAll(async () => {
    for (const t of [
      'identityVersion',
      'kycRecord',
      'kycSession',
      'documentUpload',
      'document',
      'additionalVerification',
      'task',
    ] as const) {
      await (
        prisma[t] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }
      ).deleteMany({ where: { applicationId: { startsWith: `app_${ns}` } } });
    }
    await prisma.onModuleDestroy();
  });

  it('identity versions: encrypted PAN, latest, and duplicate lookup by fingerprint', async () => {
    const pan = `ABC${ns
      .slice(0, 2)
      .toUpperCase()
      .replace(/[^A-Z]/g, 'Q')}1234F`;
    await identities.append({
      applicationId: app,
      version: 1,
      pan,
      legalName: 'Vinod',
      dateOfBirth: toIsoDate('1990-01-15'),
      permissionVersion: 'kyc_fetch_v1',
      status: 'SUBMITTED',
      submittedAt: now,
    });
    await identities.append({
      applicationId: app,
      version: 2,
      pan,
      legalName: 'Vinod K',
      dateOfBirth: toIsoDate('1990-01-15'),
      permissionVersion: 'kyc_fetch_v1',
      status: 'SUBMITTED',
      submittedAt: now,
    });
    const latest = await identities.latest(app);
    expect(latest).toMatchObject({
      version: 2,
      pan,
      legalName: 'Vinod K',
      dateOfBirth: '1990-01-15',
    });
    const row = await prisma.identityVersion.findFirstOrThrow({
      where: { applicationId: app },
    });
    expect(Buffer.from(row.panCiphertext).toString('utf8')).not.toContain(
      '1234F',
    );
    await identities.append({
      applicationId: `${app}_other`,
      version: 1,
      pan,
      legalName: 'Someone',
      dateOfBirth: toIsoDate('1991-02-02'),
      permissionVersion: 'v',
      status: 'SUBMITTED',
      submittedAt: now,
    });
    expect(
      await identities.otherApplicationsWithPan(fp.of(pan, 'pan'), app),
    ).toEqual([`${app}_other`]);
    expect(await identities.latest('app_none')).toBeNull();
  });

  it('kyc records: create, latest, version-checked save with summary json', async () => {
    const rec = {
      id: `kyc_${ns}`,
      applicationId: app,
      identityVersion: 1,
      provider: 'DIGIO_KRA' as const,
      status: 'PROCESSING' as const,
      operationId: `op_${ns}`,
      version: 0,
      updatedAt: now,
    };
    await records.create(rec);
    const updated = {
      ...rec,
      status: 'EXISTING_RECORD_AVAILABLE' as const,
      route: 'REUSE' as const,
      version: 1,
      summary: { name: 'VINOD', statusCode: '007' },
      evidenceKey: 'k',
    };
    await records.saveWithVersionCheck(updated, 0);
    expect(await records.latestForApplication(app)).toMatchObject({
      status: 'EXISTING_RECORD_AVAILABLE',
      route: 'REUSE',
      version: 1,
      summary: { name: 'VINOD' },
      evidenceKey: 'k',
    });
    await expect(
      records.saveWithVersionCheck(updated, 0),
    ).rejects.toBeInstanceOf(StaleVersionError);
    expect(await records.findById('nope')).toBeNull();
  });

  it('kyc sessions: create, find by provider id, update', async () => {
    const s = {
      id: `ks_${ns}`,
      applicationId: app,
      provider: 'DIGIO' as const,
      templateName: 'T',
      status: 'REQUESTED' as const,
      pollCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    await sessions.create(s);
    await sessions.update({
      ...s,
      providerRequestId: `KID${ns}`,
      status: 'IN_PROGRESS',
      pollCount: 2,
      lastProviderStatus: 'requested',
    });
    expect(await sessions.findByProviderRequestId(`KID${ns}`)).toMatchObject({
      id: s.id,
      status: 'IN_PROGRESS',
      pollCount: 2,
    });
    expect(await sessions.latestForApplication(app)).toMatchObject({
      id: s.id,
    });
    expect(await sessions.findById('nope')).toBeNull();
  });

  it('documents: uploads and documents round-trip; latest verified', async () => {
    const up = {
      id: `upl_${ns}`,
      applicationId: app,
      requirementId: 'ADDRESS_PROOF',
      objectKey: 'k',
      declaredContentType: 'image/jpeg',
      declaredSizeBytes: 10,
      status: 'AUTHORISED' as const,
      expiresAt: now,
      createdAt: now,
    };
    await documents.createUpload(up);
    await documents.updateUpload({ ...up, status: 'CONSUMED' });
    expect(await documents.findUpload(up.id)).toMatchObject({
      status: 'CONSUMED',
    });
    const doc = {
      id: `doc_${ns}`,
      applicationId: app,
      requirementId: 'ADDRESS_PROOF',
      documentType: 'PASSPORT',
      files: [{ uploadId: up.id, side: 'PHOTO_PAGE', objectKey: 'k' }],
      status: 'PROCESSING' as const,
      operationId: 'op',
      createdAt: now,
      updatedAt: now,
    };
    await documents.createDocument(doc);
    expect(await documents.latestVerified(app, 'ADDRESS_PROOF')).toBeNull();
    await documents.updateDocument({
      ...doc,
      status: 'VERIFIED',
      files: [
        {
          ...doc.files[0],
          sha256: 'abc',
          sizeBytes: 10,
          contentType: 'image/jpeg',
        },
      ],
    });
    expect(await documents.latestVerified(app, 'ADDRESS_PROOF')).toMatchObject({
      id: doc.id,
      files: [{ sha256: 'abc' }],
    });
    expect(await documents.findDocument('nope')).toBeNull();
  });

  it('verifications and tasks', async () => {
    const v = {
      id: `av_${ns}`,
      applicationId: app,
      type: 'SELFIE_LIVENESS' as const,
      status: 'REQUESTED' as const,
      thresholdVersion: 'ipv_v1',
      createdAt: now,
      updatedAt: now,
    };
    await verifications.create(v);
    await verifications.update({
      ...v,
      status: 'PASSED',
      livenessScore: 91,
      faceMatchConfidence: 88,
    });
    expect(await verifications.latestForApplication(app)).toMatchObject({
      status: 'PASSED',
      livenessScore: 91,
    });
    expect(await verifications.countByType(app, 'SELFIE_LIVENESS')).toBe(1);
    expect(await verifications.findById('nope')).toBeNull();
    await tasks.create({
      id: `task_${ns}`,
      applicationId: app,
      category: 'IPV_ASSISTED',
      status: 'OPEN',
      details: { reason: 'camera' },
      createdAt: now,
    });
    expect(await tasks.listOpen(app)).toMatchObject([
      {
        category: 'IPV_ASSISTED',
        status: 'OPEN',
        details: { reason: 'camera' },
      },
    ]);
  });
});

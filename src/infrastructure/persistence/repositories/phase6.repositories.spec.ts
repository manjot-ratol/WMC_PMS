import { randomUUID } from 'node:crypto';
import { FieldCipher } from '../../../common/crypto/field-cipher';
import {
  describeWithDb,
  loadTestEnv,
  migrateTestDb,
} from '../../../../test/support/db';
import type { SigningSession } from '../../../domain/signing/signing-session';
import { PrismaService } from '../prisma.service';
import { AccountOpeningRepository } from './account-opening.repository';
import { ActivationRepository } from './activation.repository';
import { FundingRepository } from './funding.repository';
import { SigningRepository } from './signing.repository';
import { TaskRepository } from './verification.repository';

describeWithDb('Phase 6 repositories (docker postgres)', () => {
  let prisma: PrismaService;
  let signing: SigningRepository;
  let accounts: AccountOpeningRepository;
  let funding: FundingRepository;
  let activations: ActivationRepository;
  let tasks: TaskRepository;
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
    signing = new SigningRepository(prisma);
    accounts = new AccountOpeningRepository(prisma);
    funding = new FundingRepository(prisma, cipher);
    activations = new ActivationRepository(prisma);
    tasks = new TaskRepository(prisma, cipher);
  });
  afterAll(async () => {
    for (const t of [
      'signingSession',
      'accountOpeningRun',
      'registrySubmission',
      'underlyingAccount',
      'fundingNotification',
      'fundingReceipt',
      'activation',
      'taskResponse',
      'task',
    ] as const) {
      await (
        prisma[t] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }
      ).deleteMany({ where: { applicationId: app } });
    }
    await prisma.onModuleDestroy();
  });

  it('signing sessions: create, lookups by provider id / snapshot / application, update', async () => {
    const s: SigningSession = {
      id: `ss_${ns}`,
      applicationId: app,
      snapshotId: `snap_${ns}`,
      documentPackVersion: 1,
      signingMethod: 'AADHAAR_ESIGN',
      status: 'REQUESTED',
      providerRequestId: `DID${ns}`,
      packObjectKey: 'k',
      packSha256: 'a'.repeat(64),
      documents: [
        {
          documentType: 'MITC',
          documentVersion: 'mitc_v1',
          objectKey: 'o',
          sha256: 'b'.repeat(64),
        },
      ],
      pollCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    await signing.create(s);
    expect(await signing.findById(s.id)).toMatchObject({
      status: 'REQUESTED',
      documents: s.documents,
      providerRequestId: `DID${ns}`,
      evidenceKey: undefined,
    });
    expect((await signing.findByProviderRequestId(`DID${ns}`))?.id).toBe(s.id);
    expect((await signing.latestForSnapshot(`snap_${ns}`))?.id).toBe(s.id);
    expect((await signing.latestForApplication(app))?.id).toBe(s.id);
    expect(await signing.findById('ss_nope')).toBeNull();
    expect(await signing.findByProviderRequestId('DIDNOPE')).toBeNull();
    await signing.update({
      ...s,
      status: 'EXECUTED',
      evidenceKey: 'signed',
      executedAt: now,
      lastProviderStatus: 'completed',
      safeErrorCategory: undefined,
    });
    expect(await signing.findById(s.id)).toMatchObject({
      status: 'EXECUTED',
      evidenceKey: 'signed',
      executedAt: now,
      lastProviderStatus: 'completed',
    });
  });

  it('account opening: runs, submissions by reference, underlying accounts deduped by receipt key', async () => {
    const run = {
      id: `ao_${ns}`,
      applicationId: app,
      snapshotId: `snap_${ns}`,
      documentPackVersion: 1,
      status: 'QUEUED' as const,
      blockers: [],
      createdAt: now,
      updatedAt: now,
    };
    await accounts.createRun(run);
    expect((await accounts.latestRun(app))?.id).toBe(run.id);
    expect(await accounts.findRun('ao_nope')).toBeNull();
    await accounts.updateRun({
      ...run,
      status: 'BLOCKED',
      blockers: ['x'],
      completedAt: now,
    });
    expect(await accounts.findRun(run.id)).toMatchObject({
      status: 'BLOCKED',
      blockers: ['x'],
      completedAt: now,
    });
    const sub = {
      id: `rs_${ns}`,
      applicationId: app,
      runId: run.id,
      registry: 'KRA' as const,
      status: 'SUBMITTED' as const,
      providerRequestId: `KRA${ns}`,
      clientReferenceId: `rs_${ns}`,
      deadlineAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await accounts.createSubmission(sub);
    await accounts.createSubmission({
      ...sub,
      id: `rs_${ns}_c`,
      registry: 'CKYC',
      status: 'NOT_REQUIRED',
      providerRequestId: undefined,
      clientReferenceId: undefined,
      basis: 'CKYC_DISABLED_BY_POLICY',
      deadlineAt: undefined,
    });
    expect(
      (
        await accounts.findSubmissionByReference({
          providerRequestId: `KRA${ns}`,
        })
      )?.id,
    ).toBe(sub.id);
    expect(
      (
        await accounts.findSubmissionByReference({
          clientReferenceId: `rs_${ns}`,
        })
      )?.id,
    ).toBe(sub.id);
    expect(await accounts.findSubmissionByReference({})).toBeNull();
    expect(
      await accounts.findSubmissionByReference({ providerRequestId: 'nope' }),
    ).toBeNull();
    await accounts.updateSubmission({
      ...sub,
      status: 'VALIDATED',
      lastProviderStatus: 'KRA_VALIDATED',
      evidenceKey: 'e',
      safeErrorCategory: undefined,
    });
    expect(
      (await accounts.listSubmissions(app)).map((x) => [
        x.registry,
        x.status,
        x.basis,
      ]),
    ).toEqual([
      ['KRA', 'VALIDATED', undefined],
      ['CKYC', 'NOT_REQUIRED', 'CKYC_DISABLED_BY_POLICY'],
    ]);
    const acc = {
      id: `ua_${ns}`,
      applicationId: app,
      providerReceiptKey: `key_${ns}`,
      provider: 'CUSTODIAN',
      accountType: 'PMS_ACCOUNT',
      accountReference: 'PMS1',
      status: 'READY' as const,
      receivedAt: now,
    };
    expect(await accounts.insertUnderlyingAccountIfNew(acc)).toEqual({
      inserted: true,
      account: acc,
    });
    const dup = await accounts.insertUnderlyingAccountIfNew({
      ...acc,
      id: `ua_${ns}_2`,
      accountReference: 'OTHER',
    });
    expect(dup).toMatchObject({
      inserted: false,
      account: { id: acc.id, accountReference: 'PMS1' },
    });
    expect(await accounts.listUnderlyingAccounts(app)).toHaveLength(1);
  });

  it('funding: encrypted notification reference, receipts deduped and summed by match status', async () => {
    await funding.createNotification({
      id: `fn_${ns}`,
      applicationId: app,
      fundingMethod: 'BANK_TRANSFER',
      customerTransferReference: `UTR${ns}`,
      createdAt: now,
    });
    expect(await funding.latestNotification(app)).toMatchObject({
      customerTransferReference: `UTR${ns}`,
    });
    expect(await funding.latestNotification('app_nope')).toBeNull();
    const raw = await prisma.fundingNotification.findFirstOrThrow({
      where: { applicationId: app },
    });
    expect(
      Buffer.from(raw.customerTransferReference).toString('utf8'),
    ).not.toContain(ns);
    const r = {
      id: `fr_${ns}`,
      applicationId: app,
      providerReceiptKey: `rk_${ns}`,
      provider: 'BANK',
      amountInr: 2_500_000,
      currency: 'INR',
      sourceAccountFingerprint: 'fp',
      destinationReference: 'PMS-1',
      valueDate: '2026-10-18',
      matchStatus: 'MATCHED' as const,
      mismatchReasons: [],
      receivedAt: now,
    };
    expect(await funding.insertReceiptIfNew(r)).toEqual({
      inserted: true,
      receipt: r,
    });
    expect(
      await funding.insertReceiptIfNew({
        ...r,
        id: `fr_${ns}_dup`,
        amountInr: 9,
      }),
    ).toMatchObject({
      inserted: false,
      receipt: { id: r.id, amountInr: 2_500_000 },
    });
    await funding.insertReceiptIfNew({
      ...r,
      id: `fr_${ns}_u`,
      providerReceiptKey: `rk_${ns}_u`,
      matchStatus: 'UNMATCHED',
      mismatchReasons: ['source_account_mismatch'],
      sourceAccountFingerprint: undefined,
    });
    expect(await funding.sumMatched(app)).toBe(2_500_000);
    expect(await funding.sumMatched('app_nope')).toBe(0);
    expect(
      (await funding.listReceipts(app)).map((x) => [
        x.matchStatus,
        x.mismatchReasons,
        x.sourceAccountFingerprint,
      ]),
    ).toEqual([
      ['MATCHED', [], 'fp'],
      ['UNMATCHED', ['source_account_mismatch'], undefined],
    ]);
  });

  it('activations are unique per application; tasks can be found, updated and answered (text encrypted)', async () => {
    await activations.create({
      id: `act_${ns}`,
      applicationId: app,
      pmsAccountId: 'PMS1',
      gateSnapshot: { blockers: [] },
      activatedAt: now,
    });
    expect(await activations.findByApplication(app)).toMatchObject({
      pmsAccountId: 'PMS1',
      gateSnapshot: { blockers: [] },
    });
    expect(await activations.findByApplication('app_nope')).toBeNull();
    await expect(
      activations.create({
        id: `act_${ns}_2`,
        applicationId: app,
        pmsAccountId: 'PMS2',
        gateSnapshot: {},
        activatedAt: now,
      }),
    ).rejects.toThrow();
    await tasks.create({
      id: `task_${ns}`,
      applicationId: app,
      category: 'CLARIFICATION',
      status: 'OPEN',
      details: { a: 1 },
      createdAt: now,
    });
    expect(await tasks.findById(`task_${ns}`)).toMatchObject({
      category: 'CLARIFICATION',
      status: 'OPEN',
      details: { a: 1 },
    });
    expect(await tasks.findById('task_nope')).toBeNull();
    await tasks.createResponse({
      id: `tr_${ns}`,
      taskId: `task_${ns}`,
      applicationId: app,
      responseType: 'TEXT',
      documentIds: [],
      text: `secret ${ns}`,
      submittedAt: now,
    });
    await tasks.createResponse({
      id: `tr_${ns}_d`,
      taskId: `task_${ns}`,
      applicationId: app,
      responseType: 'DOCUMENT',
      documentIds: ['doc_1'],
      submittedAt: now,
    });
    const rows = await prisma.taskResponse.findMany({
      where: { taskId: `task_${ns}` },
    });
    expect(rows.map((x) => x.text === null)).toEqual([false, true]);
    expect(Buffer.from(rows[0].text!).toString('utf8')).not.toContain(ns);
    await tasks.update({
      id: `task_${ns}`,
      applicationId: app,
      category: 'CLARIFICATION',
      status: 'RESOLVED',
      createdAt: now,
      resolvedAt: now,
    });
    expect(await tasks.listOpen(app)).toEqual([]);
    expect((await tasks.findById(`task_${ns}`))?.resolvedAt).toEqual(now);
  });
});

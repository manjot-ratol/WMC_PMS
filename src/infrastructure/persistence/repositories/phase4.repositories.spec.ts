import { randomUUID } from 'node:crypto';
import { FieldCipher } from '../../../common/crypto/field-cipher';
import { Fingerprint } from '../../../common/crypto/fingerprint';
import {
  describeWithDb,
  loadTestEnv,
  migrateTestDb,
} from '../../../../test/support/db';
import { PrismaService } from '../prisma.service';
import { BankRepository } from './bank.repository';
import { ComplianceRepository } from './compliance.repository';
import { NominationRepository } from './nomination.repository';
import {
  DeclarationsRepository,
  ProfileRepository,
} from './profile.repository';

describeWithDb('Phase 4 repositories (docker postgres)', () => {
  let prisma: PrismaService;
  let profiles: ProfileRepository;
  let declarations: DeclarationsRepository;
  let bank: BankRepository;
  let nominations: NominationRepository;
  let compliance: ComplianceRepository;
  let fp: Fingerprint;
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
    fp = new Fingerprint({
      fingerprintKeyBase64: process.env.FINGERPRINT_HMAC_KEY!,
    });
    profiles = new ProfileRepository(prisma, cipher);
    declarations = new DeclarationsRepository(prisma, cipher);
    bank = new BankRepository(prisma, cipher, fp);
    nominations = new NominationRepository(prisma, cipher);
    compliance = new ComplianceRepository(prisma);
  });
  afterAll(async () => {
    for (const t of [
      'customerProfile',
      'declaration',
      'bankAccount',
      'bankVerification',
      'nomination',
      'screeningRun',
      'amlAssessment',
    ] as const) {
      await (
        prisma[t] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }
      ).deleteMany({ where: { applicationId: app } });
    }
    await prisma.onModuleDestroy();
  });

  it('profiles and declarations: encrypted restricted fields, latest version', async () => {
    await profiles.append({
      applicationId: app,
      version: 1,
      occupation: 'PRIVATE_SECTOR',
      annualIncomeBand: 'INR_10L_25L',
      sourceOfFunds: ['SALARY'],
      evidenceRequired: false,
      savedAt: now,
    });
    await profiles.append({
      applicationId: app,
      version: 2,
      occupation: 'BUSINESS',
      annualIncomeBand: 'INR_ABOVE_1CR',
      sourceOfFunds: ['INHERITANCE'],
      sourceOfFundsExplanation: 'late father estate',
      evidenceRequired: true,
      savedAt: now,
    });
    expect(await profiles.latest(app)).toMatchObject({
      version: 2,
      occupation: 'BUSINESS',
      sourceOfFundsExplanation: 'late father estate',
      evidenceRequired: true,
    });
    const row = await prisma.customerProfile.findUniqueOrThrow({
      where: { applicationId_version: { applicationId: app, version: 2 } },
    });
    expect(
      Buffer.from(row.sourceOfFundsExplanation!).toString('utf8'),
    ).not.toContain('estate');
    await declarations.append({
      applicationId: app,
      version: 1,
      taxResidencies: [
        { country: 'IN', tin: 'ABCPE1234F' },
        { country: 'US', tin: '123456789' },
      ],
      pepDeclaration: 'NOT_PEP',
      declarationVersion: 'declarations_v1',
      additionalInformationRequired: true,
      attestedAt: now,
    });
    expect(await declarations.latest(app)).toMatchObject({
      version: 1,
      taxResidencies: [{ country: 'IN', tin: 'ABCPE1234F' }, { country: 'US' }],
      additionalInformationRequired: true,
    });
    const drow = await prisma.declaration.findFirstOrThrow({
      where: { applicationId: app },
    });
    expect(Buffer.from(drow.taxResidencies).toString('utf8')).not.toContain(
      'ABCPE1234F',
    );
    expect(await profiles.latest('nope')).toBeNull();
    expect(await declarations.latest('nope')).toBeNull();
  });

  it('bank accounts and verifications', async () => {
    const acc = {
      id: `ba_${ns}`,
      applicationId: app,
      accountNumber: '999912345678',
      ifsc: 'HDFC0001234',
      holderName: 'VINOD',
      version: 1,
      createdAt: now,
    };
    await bank.createAccount(acc);
    expect(await bank.findAccount(acc.id)).toMatchObject({
      accountNumber: '999912345678',
      ifsc: 'HDFC0001234',
    });
    expect(
      await bank.findAccountByFingerprint(
        app,
        fp.of('999912345678', 'account'),
      ),
    ).toMatchObject({ id: acc.id });
    expect(await bank.findAccountByFingerprint(app, 'nope')).toBeNull();
    const row = await prisma.bankAccount.findUniqueOrThrow({
      where: { id: acc.id },
    });
    expect(Buffer.from(row.accountCiphertext).toString('utf8')).not.toContain(
      '12345678',
    );
    const v = {
      id: `bv_${ns}`,
      applicationId: app,
      bankAccountId: acc.id,
      status: 'PROCESSING' as const,
      requiredActions: [],
      createdAt: now,
      updatedAt: now,
    };
    await bank.createVerification(v);
    await bank.updateVerification({
      ...v,
      status: 'ACTION_REQUIRED',
      requiredActions: ['CORRECT_DETAILS'],
      safeErrorCategory: 'name_mismatch',
      providerReference: 'FTI1',
      evidenceKey: 'k',
    });
    expect(await bank.findVerification(v.id)).toMatchObject({
      status: 'ACTION_REQUIRED',
      requiredActions: ['CORRECT_DETAILS'],
      providerReference: 'FTI1',
    });
    expect(await bank.latestVerification(app)).toMatchObject({ id: v.id });
    expect(await bank.countVerifications(app)).toBe(1);
    expect(await bank.findVerification('nope')).toBeNull();
  });

  it('nominations are encrypted and versioned; compliance rows queue and supersede', async () => {
    await nominations.append({
      applicationId: app,
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
    expect(await nominations.latest(app)).toMatchObject({
      version: 1,
      choice: 'NOMINATE',
      nominees: [{ fullName: 'Asha Singh', allocationPercent: 100 }],
    });
    const nrow = await prisma.nomination.findFirstOrThrow({
      where: { applicationId: app },
    });
    expect(Buffer.from(nrow.nomineesCiphertext).toString('utf8')).not.toContain(
      'Asha',
    );
    expect(await nominations.latest('nope')).toBeNull();
    await compliance.createScreeningRun({
      id: `sr_${ns}`,
      applicationId: app,
      identityVersion: 1,
      screeningPolicyVersion: 'screening_v1',
      status: 'QUEUED',
      createdAt: now,
    });
    await compliance.createAmlAssessment({
      id: `aml_${ns}`,
      applicationId: app,
      identityVersion: 1,
      profileVersion: 2,
      declarationVersion: 1,
      policyVersion: 'aml_v1',
      status: 'QUEUED',
      createdAt: now,
    });
    expect(await compliance.latestScreeningRun(app)).toMatchObject({
      status: 'QUEUED',
    });
    await compliance.supersedeOpen(app);
    expect(await compliance.latestScreeningRun(app)).toMatchObject({
      status: 'SUPERSEDED',
    });
    expect(await compliance.latestAmlAssessment(app)).toMatchObject({
      status: 'SUPERSEDED',
      profileVersion: 2,
    });
    expect(await compliance.latestAmlAssessment('nope')).toBeNull();
    expect(await compliance.latestScreeningRun('nope')).toBeNull();
  });
});

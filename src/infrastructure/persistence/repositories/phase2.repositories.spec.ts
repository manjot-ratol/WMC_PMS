import { randomUUID } from 'node:crypto';
import { CorrelationStore } from '../../../common/correlation/correlation.store';
import { FieldCipher } from '../../../common/crypto/field-cipher';
import { Fingerprint } from '../../../common/crypto/fingerprint';
import { StaleVersionError } from '../../../common/errors/app-error';
import {
  DEFAULT_OTP_POLICY,
  newChallenge,
  withStatus,
} from '../../../domain/identity/challenge';
import {
  newProvisionalCustomer,
  proposeEmail,
  verifyPhone,
} from '../../../domain/identity/customer';
import {
  applyEligibility,
  completeStep,
  newApplication,
} from '../../../domain/onboarding/application';
import { normaliseEmail } from '../../../domain/shared/email-address';
import { normalisePhone } from '../../../domain/shared/phone-number';
import {
  describeWithDb,
  loadTestEnv,
  migrateTestDb,
} from '../../../../test/support/db';
import { PrismaService } from '../prisma.service';
import { PrismaUnitOfWork } from '../unit-of-work';
import { AnalyticsOutboxRepository } from './analytics-outbox.repository';
import { ApplicationRepository } from './application.repository';
import { ChallengeRepository } from './challenge.repository';
import { CustomerRepository } from './customer.repository';
import { EligibilityRepository } from './eligibility.repository';
import { InboxRepository } from './inbox.repository';
import { SessionRepository } from './session.repository';

describeWithDb('Phase 2 repositories (docker postgres)', () => {
  let prisma: PrismaService;
  let customers: CustomerRepository;
  let applications: ApplicationRepository;
  let challenges: ChallengeRepository;
  let sessions: SessionRepository;
  let eligibility: EligibilityRepository;
  let analytics: AnalyticsOutboxRepository;
  let uow: PrismaUnitOfWork;
  const ns = randomUUID().slice(0, 8);
  const now = new Date('2026-10-18T00:00:00Z');
  const store = new CorrelationStore();
  // unique phone per test file run: last 10 digits derived from the namespace
  const phone = normalisePhone(
    '9' + (parseInt(ns, 16) % 1_000_000_000).toString().padStart(9, '0'),
  );

  beforeAll(async () => {
    loadTestEnv();
    migrateTestDb();
    prisma = new PrismaService({ url: process.env.DATABASE_URL! });
    await prisma.onModuleInit();
    const cipher = new FieldCipher({
      fieldKeyId: 'k1',
      fieldKeyBase64: process.env.FIELD_ENCRYPTION_KEY!,
    });
    const fp = new Fingerprint({
      fingerprintKeyBase64: process.env.FINGERPRINT_HMAC_KEY!,
    });
    customers = new CustomerRepository(prisma, cipher, fp);
    applications = new ApplicationRepository(prisma);
    challenges = new ChallengeRepository(prisma, store);
    sessions = new SessionRepository(prisma);
    eligibility = new EligibilityRepository(prisma);
    analytics = new AnalyticsOutboxRepository(prisma, store);
    uow = new PrismaUnitOfWork(prisma);
  });
  afterAll(async () => {
    await prisma.analyticsOutbox.deleteMany({
      where: { correlationId: { startsWith: ns } },
    });
    await prisma.eligibilityDecision.deleteMany({
      where: { applicationId: { startsWith: `app_${ns}` } },
    });
    await prisma.onboardingApplication.deleteMany({
      where: { customerId: { startsWith: `cus_${ns}` } },
    });
    await prisma.authChallenge.deleteMany({
      where: { id: { startsWith: `ch_${ns}` } },
    });
    await prisma.session.deleteMany({
      where: { customerId: { startsWith: `cus_${ns}` } },
    });
    await prisma.customer.deleteMany({
      where: { id: { startsWith: `cus_${ns}` } },
    });
    await prisma.onModuleDestroy();
  });

  it('customer: encrypted at rest, found by fingerprint, version-checked saves', async () => {
    const c = newProvisionalCustomer(`cus_${ns}_1`, phone, now);
    await customers.create(c);
    const row = await prisma.customer.findUniqueOrThrow({
      where: { id: c.id },
    });
    expect(Buffer.from(row.phoneCiphertext).toString('utf8')).not.toContain(
      phone.slice(-6),
    );
    const fp = new Fingerprint({
      fingerprintKeyBase64: process.env.FINGERPRINT_HMAC_KEY!,
    }).of(phone, 'phone');
    expect(await customers.findByPhoneFingerprint(fp)).toMatchObject({
      id: c.id,
      phone,
      state: 'UNVERIFIED',
      version: 0,
    });
    const v1 = proposeEmail(
      verifyPhone(c, now),
      normaliseEmail('x@example.com'),
    );
    await customers.saveWithVersionCheck(v1, c.version);
    expect(await customers.findById(c.id)).toMatchObject({
      state: 'VERIFIED',
      email: 'x@example.com',
      version: 2,
    });
    await expect(
      customers.saveWithVersionCheck(v1, c.version),
    ).rejects.toBeInstanceOf(StaleVersionError);
    expect(await customers.findById('cus_nope')).toBeNull();
  });

  it('application: create with steps, find in-progress, version-checked save upserts steps; one in-progress per customer', async () => {
    const custId = `cus_${ns}_2`;
    await customers.create(
      newProvisionalCustomer(
        custId,
        normalisePhone(
          '9' +
            ((parseInt(ns, 16) + 1) % 1_000_000_000)
              .toString()
              .padStart(9, '0'),
        ),
        now,
      ),
    );
    const app = newApplication(`app_${ns}_1`, custId, now);
    await applications.create(app);
    expect(await applications.findInProgressByCustomer(custId)).toMatchObject({
      id: app.id,
      nextScreen: 'EMAIL_ENTRY',
      version: 0,
    });
    expect((await applications.findById(app.id))?.steps).toEqual([
      {
        stepId: 'PHONE_VERIFIED',
        status: 'COMPLETE',
        version: 1,
        completedAt: now,
      },
    ]);
    const a1 = completeStep(app, 'EMAIL_VERIFIED', 'ELIGIBILITY', now);
    await applications.saveWithVersionCheck(a1, app.version);
    const loaded = await applications.findById(app.id);
    expect(loaded?.steps.map((s) => s.stepId).sort()).toEqual([
      'EMAIL_VERIFIED',
      'PHONE_VERIFIED',
    ]);
    await expect(
      applications.saveWithVersionCheck(a1, app.version),
    ).rejects.toBeInstanceOf(StaleVersionError);
    await expect(
      applications.create(newApplication(`app_${ns}_dup`, custId, now)),
    ).rejects.toThrow();
    expect(await applications.listIdsByCustomer(custId)).toEqual([app.id]);
    const a2 = applyEligibility(
      a1,
      {
        status: 'ASSISTED_REQUIRED',
        rulesetVersion: 'v1',
        reasons: ['r'],
        nextScreen: 'ASSISTED_ONBOARDING',
      },
      now,
    );
    await applications.saveWithVersionCheck(a2, a1.version);
    expect(await applications.findInProgressByCustomer(custId)).toBeNull();
  });

  it('analytics without identity, inbox get, and assisted eligibility rows', async () => {
    const inboxRepo = new InboxRepository(prisma, store);
    await store.run({ correlationId: `${ns}-b`, requestId: 'r' }, () =>
      analytics.track({
        name: 'OTP Dispatch Updated',
        screenId: '01',
        outcome: 'accepted',
      }),
    );
    const row = await prisma.analyticsOutbox.findFirstOrThrow({
      where: { correlationId: `${ns}-b` },
    });
    expect(row.identity).toBeNull();
    const ins = await inboxRepo.insertIfNew('sit', `${ns}-get`, { a: 1 });
    expect(await inboxRepo.get(ins.id)).toMatchObject({
      provider: 'sit',
      eventKey: `${ns}-get`,
      status: 'RECEIVED',
    });
    expect(
      await inboxRepo.get('00000000-0000-0000-0000-000000000000'),
    ).toBeNull();
    const appId = `app_${ns}_assisted`;
    const input = {
      customerType: 'INDIVIDUAL',
      residentialStatus: 'NRI',
      intendedInvestmentInr: 5_000_000,
      distributionRoute: 'DIRECT',
    } as const;
    await eligibility.append({
      id: `elg_${ns}_a`,
      applicationId: appId,
      version: 1,
      input,
      status: 'ASSISTED_REQUIRED',
      rulesetVersion: 'eligibility_v1',
      reasons: ['residential_status:NRI'],
      nextScreen: 'ASSISTED_ONBOARDING',
      decidedAt: now,
    });
    expect(await eligibility.latest(appId)).toMatchObject({
      status: 'ASSISTED_REQUIRED',
      nextScreen: 'ASSISTED_ONBOARDING',
      journeyRoute: undefined,
    });
    await prisma.integrationInbox.deleteMany({
      where: { eventKey: `${ns}-get` },
    });
  });

  it('challenge and session round-trip; eligibility append/latest; analytics allowlist', async () => {
    const ch = newChallenge(
      {
        id: `ch_${ns}_1`,
        channel: 'PHONE',
        purpose: 'PMS_ONBOARDING',
        targetFingerprint: 'fp',
      },
      DEFAULT_OTP_POLICY,
      now,
    );
    await store.run({ correlationId: `${ns}-c`, requestId: 'r' }, () =>
      challenges.create(ch),
    );
    expect(await challenges.findById(ch.id)).toEqual(ch);
    await challenges.update(withStatus(ch, 'VERIFIED', now));
    expect((await challenges.findById(ch.id))?.verifiedAt).toEqual(now);

    await sessions.create({
      id: `ses_${ns}`,
      tokenHash: `h_${ns}`,
      customerId: `cus_${ns}_1`,
      expiresAt: new Date(now.getTime() + 1000),
    });
    await sessions.revoke(`h_${ns}`);
    expect(
      (
        await prisma.session.findUniqueOrThrow({
          where: { tokenHash: `h_${ns}` },
        })
      ).revokedAt,
    ).not.toBeNull();

    const appId = `app_${ns}_1`;
    const input = {
      customerType: 'INDIVIDUAL',
      residentialStatus: 'RESIDENT',
      intendedInvestmentInr: 5_000_000,
      distributionRoute: 'DIRECT',
    } as const;
    await eligibility.append({
      id: `elg_${ns}_1`,
      applicationId: appId,
      version: 1,
      input,
      status: 'ELIGIBLE',
      rulesetVersion: 'eligibility_v1',
      journeyRoute: 'R',
      reasons: [],
      nextScreen: 'PAN_IDENTITY',
      decidedAt: now,
    });
    await eligibility.append({
      id: `elg_${ns}_2`,
      applicationId: appId,
      version: 2,
      input: { ...input, intendedInvestmentInr: 1 },
      status: 'NOT_ELIGIBLE',
      rulesetVersion: 'eligibility_v1',
      reasons: ['x'],
      nextScreen: 'NOT_ELIGIBLE',
      decidedAt: now,
    });
    expect(await eligibility.latest(appId)).toMatchObject({
      version: 2,
      status: 'NOT_ELIGIBLE',
      nextScreen: 'NOT_ELIGIBLE',
      input: { intendedInvestmentInr: 1 },
    });
    expect(await eligibility.latest('app_none')).toBeNull();

    await store.run({ correlationId: `${ns}-a`, requestId: 'r' }, () =>
      uow.run((tx) =>
        analytics.track(
          {
            name: 'Phone Verification Completed',
            applicationId: appId,
            screenId: '02',
            outcome: 'verified',
            identity: 'cus_x',
          },
          tx,
        ),
      ),
    );
    const row = await prisma.analyticsOutbox.findFirstOrThrow({
      where: { correlationId: `${ns}-a` },
    });
    expect(row.eventName).toBe('Phone Verification Completed');
    expect(Object.keys(row.properties as object).sort()).toEqual([
      'application_id',
      'event_id',
      'event_schema_version',
      'event_source',
      'journey_version',
      'outcome',
      'screen_id',
    ]);
  });
});

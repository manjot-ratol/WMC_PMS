import {
  FakeAnalytics,
  FakeApplications,
  FakeAudit,
  FakeChallenges,
  FakeCustomers,
  FakeKv,
  FakeOutbox,
  FakeRateLimiter,
  FakeUow,
  FixedClock,
  SeqIds,
  silentLogger,
} from '../../../test/support/fakes';
import { Fingerprint } from '../../common/crypto/fingerprint';
import {
  NotFoundError,
  OtpInvalidError,
  RateLimitedError,
  ValidationError,
} from '../../common/errors/app-error';
import {
  newProvisionalCustomer,
  verifyPhone,
} from '../../domain/identity/customer';
import { newApplication } from '../../domain/onboarding/application';
import { normalisePhone } from '../../domain/shared/phone-number';
import { OtpService } from '../auth/otp.service';
import { EmailVerificationService } from './email-verification.service';

function build() {
  const fingerprint = new Fingerprint({
    fingerprintKeyBase64: Buffer.alloc(32, 2).toString('base64'),
  });
  const kv = new FakeKv();
  const clock = new FixedClock();
  kv.now = () => clock.now().getTime();
  const deps = {
    uow: new FakeUow(),
    customers: new FakeCustomers((p) => fingerprint.of(p, 'phone')),
    applications: new FakeApplications(),
    challenges: new FakeChallenges(),
    limiter: new FakeRateLimiter(),
    email: { send: jest.fn().mockResolvedValue({ accepted: true }) },
    audit: new FakeAudit(),
    outbox: new FakeOutbox(),
    analytics: new FakeAnalytics(),
    clock,
    ids: new SeqIds(),
    kv,
  };
  const otp = new OtpService(kv, {
    otpHmacKeyBase64: Buffer.alloc(32, 3).toString('base64'),
  });
  const cfg = {
    sessionTtlSeconds: 1800,
    preAuthTtlSeconds: 600,
    otpTtlSeconds: 300,
    otpResendAfterSeconds: 30,
    otpMaxAttempts: 5,
  };
  const service = new EmailVerificationService(
    deps.uow,
    deps.customers,
    deps.applications,
    deps.challenges,
    deps.limiter,
    deps.email,
    deps.audit,
    deps.outbox,
    deps.analytics,
    deps.clock,
    deps.ids,
    cfg,
    fingerprint,
    otp,
    silentLogger as never,
  );
  const now = clock.now();
  const customer = verifyPhone(
    newProvisionalCustomer('cus_1', normalisePhone('9000000001'), now),
    now,
  );
  void deps.customers.create(customer);
  const app = newApplication('app_1', 'cus_1', now);
  void deps.applications.create(app);
  const other = newApplication('app_2', 'cus_2', now);
  void deps.applications.create(other);
  const sentOtp = () =>
    (
      deps.email.send.mock.calls.at(-1) as [string, { vars: { otp: string } }]
    )[1].vars.otp;
  return { service, deps, otp, sentOtp };
}
const create = {
  applicationId: 'app_1',
  customerId: 'cus_1',
  email: 'Customer@Example.com',
};

describe('EmailVerificationService', () => {
  it('create stores the proposed email, dispatches and returns the masked address', async () => {
    const { service, deps } = build();
    const r = await service.create(create);
    expect(r).toMatchObject({
      status: 'DISPATCHED',
      emailMasked: 'C***@example.com',
      expiresInSeconds: 300,
    });
    expect(deps.customers.rows.get('cus_1')).toMatchObject({
      email: 'Customer@example.com',
      emailVerifiedAt: undefined,
    });
    expect((deps.email.send.mock.calls as [string, unknown][])[0][0]).toBe(
      'Customer@example.com',
    );
    expect(deps.analytics.events.map((e) => e.name)).toEqual([
      'Email Challenge Created',
      'Email Dispatch Updated',
    ]);
    expect(JSON.stringify(deps.analytics.events)).not.toContain('example.com');
  });

  it('changing the email supersedes the pending challenge', async () => {
    const { service, deps, sentOtp } = build();
    const first = await service.create(create);
    const firstOtp = sentOtp();
    const second = await service.create({
      ...create,
      email: 'new@example.com',
    });
    expect(deps.challenges.rows.get(first.challengeId)?.status).toBe(
      'SUPERSEDED',
    );
    await expect(
      service.verify({
        applicationId: 'app_1',
        customerId: 'cus_1',
        challengeId: first.challengeId,
        otp: firstOtp,
      }),
    ).rejects.toBeInstanceOf(OtpInvalidError);
    await expect(
      service.verify({
        applicationId: 'app_1',
        customerId: 'cus_1',
        challengeId: second.challengeId,
        otp: sentOtp(),
      }),
    ).resolves.toEqual({ status: 'VERIFIED', nextScreen: 'ELIGIBILITY' });
  });

  it('verify marks the email verified, completes the step and advances to ELIGIBILITY', async () => {
    const { service, deps, sentOtp } = build();
    const c = await service.create(create);
    const r = await service.verify({
      applicationId: 'app_1',
      customerId: 'cus_1',
      challengeId: c.challengeId,
      otp: sentOtp(),
    });
    expect(r).toEqual({ status: 'VERIFIED', nextScreen: 'ELIGIBILITY' });
    expect(deps.customers.rows.get('cus_1')?.emailVerifiedAt).toBeDefined();
    expect(deps.applications.rows.get('app_1')).toMatchObject({
      nextScreen: 'ELIGIBILITY',
      version: 1,
    });
    expect(deps.outbox.events.map((e) => e.eventType)).toEqual([
      'StepCompleted',
    ]);
    expect(deps.analytics.events.at(-1)?.name).toBe(
      'Email Verification Completed',
    );
  });

  it('rejects a challenge from another application or another customer, and a wrong code', async () => {
    const { service, sentOtp } = build();
    const c = await service.create(create);
    const otp = sentOtp();
    await expect(
      service.verify({
        applicationId: 'app_2',
        customerId: 'cus_1',
        challengeId: c.challengeId,
        otp,
      }),
    ).rejects.toBeInstanceOf(OtpInvalidError);
    await expect(
      service.verify({
        applicationId: 'app_1',
        customerId: 'cus_9',
        challengeId: c.challengeId,
        otp,
      }),
    ).rejects.toBeInstanceOf(OtpInvalidError);
    await expect(
      service.verify({
        applicationId: 'app_1',
        customerId: 'cus_1',
        challengeId: c.challengeId,
        otp: otp === '000000' ? '000001' : '000000',
      }),
    ).rejects.toBeInstanceOf(OtpInvalidError);
  });

  it('a phone-channel challenge id can never verify an email', async () => {
    const { service, deps } = build();
    deps.challenges.rows.set('ch_phone', {
      id: 'ch_phone',
      channel: 'PHONE',
      purpose: 'PMS_ONBOARDING',
      targetFingerprint: 'x',
      customerId: 'cus_1',
      applicationId: 'app_1',
      status: 'DISPATCHED',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 100000),
      resendAfter: new Date(),
      maxAttempts: 5,
    });
    await expect(
      service.verify({
        applicationId: 'app_1',
        customerId: 'cus_1',
        challengeId: 'ch_phone',
        otp: '123456',
      }),
    ).rejects.toBeInstanceOf(OtpInvalidError);
  });

  it('create requires an owned, in-progress application, a valid email, and respects the rate limit', async () => {
    const { service, deps } = build();
    await expect(
      service.create({ ...create, applicationId: 'app_2' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      service.create({ ...create, email: 'nope' }),
    ).rejects.toBeInstanceOf(ValidationError);
    for (let i = 0; i < 5; i++) await service.create(create);
    await expect(service.create(create)).rejects.toBeInstanceOf(
      RateLimitedError,
    );
    deps.applications.rows.set('app_1', {
      ...deps.applications.rows.get('app_1')!,
      status: 'WITHDRAWN',
    });
    await expect(service.create(create)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('resend respects the cooldown, then supersedes and redelivers', async () => {
    const { service, deps, sentOtp } = build();
    const c = await service.create(create);
    await expect(
      service.resend({
        applicationId: 'app_1',
        customerId: 'cus_1',
        challengeId: c.challengeId,
      }),
    ).rejects.toBeInstanceOf(RateLimitedError);
    deps.clock.advance(31_000);
    const r = await service.resend({
      applicationId: 'app_1',
      customerId: 'cus_1',
      challengeId: c.challengeId,
    });
    expect(r.status).toBe('DISPATCHED');
    expect(deps.challenges.rows.get(c.challengeId)?.status).toBe('SUPERSEDED');
    await expect(
      service.verify({
        applicationId: 'app_1',
        customerId: 'cus_1',
        challengeId: r.challengeId,
        otp: sentOtp(),
      }),
    ).resolves.toMatchObject({ status: 'VERIFIED' });
  });

  it('marks DISPATCH_FAILED when the mail sender fails', async () => {
    const { service, deps } = build();
    deps.email.send.mockRejectedValueOnce(new Error('smtp'));
    expect((await service.create(create)).status).toBe('DISPATCH_FAILED');
  });
});

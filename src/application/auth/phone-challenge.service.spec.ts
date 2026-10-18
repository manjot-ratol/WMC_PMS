import {
  FakeAnalytics,
  FakeApplications,
  FakeAudit,
  FakeChallenges,
  FakeCustomers,
  FakeKv,
  FakeOutbox,
  FakePreAuth,
  FakeRateLimiter,
  FakeSessionStore,
  FakeSessions,
  FakeUow,
  FixedClock,
  SeqIds,
  silentLogger,
} from '../../../test/support/fakes';
import { Fingerprint } from '../../common/crypto/fingerprint';
import {
  DependencyUnavailableError,
  OtpInvalidError,
  RateLimitedError,
  ValidationError,
} from '../../common/errors/app-error';
import { ApplicationLifecycleService } from '../onboarding/application-lifecycle.service';
import { OtpService } from './otp.service';
import { PhoneChallengeService } from './phone-challenge.service';

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
    challenges: new FakeChallenges(),
    applications: new FakeApplications(),
    sessions: new FakeSessions(),
    limiter: new FakeRateLimiter(),
    sms: { send: jest.fn().mockResolvedValue({ accepted: true }) },
    preauth: new FakePreAuth(),
    sessionStore: new FakeSessionStore(),
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
  const service = new PhoneChallengeService(
    deps.uow,
    deps.customers,
    deps.challenges,
    deps.applications,
    deps.sessions,
    deps.limiter,
    deps.sms,
    deps.preauth,
    deps.sessionStore,
    deps.audit,
    deps.outbox,
    deps.analytics,
    deps.clock,
    deps.ids,
    cfg,
    fingerprint,
    otp,
    new ApplicationLifecycleService(deps.applications, deps.ids),
    silentLogger as never,
  );
  const sentOtp = () =>
    (deps.sms.send.mock.calls.at(-1) as [string, { vars: { otp: string } }])[1]
      .vars.otp;
  return { service, deps, otp, fingerprint, sentOtp };
}

const cmd = {
  phone: '9000000001',
  purpose: 'PMS_ONBOARDING' as const,
  privacyNoticeVersion: 'privacy_v1',
  clientIp: '1.2.3.4',
};

describe('PhoneChallengeService.create', () => {
  it('creates a provisional customer, a dispatched challenge, analytics, audit and a pre-auth token', async () => {
    const { service, deps } = build();
    const r = await service.create(cmd);
    expect(r).toMatchObject({
      challengeId: 'ch_2',
      status: 'DISPATCHED',
      expiresInSeconds: 300,
      resendAfterSeconds: 30,
      phoneMasked: '+91 ******0001',
    });
    expect(deps.preauth.tokens.get(r.preauthToken)).toMatchObject({
      purpose: 'PMS_ONBOARDING',
    });
    expect([...deps.customers.rows.values()][0]).toMatchObject({
      id: 'cus_1',
      state: 'UNVERIFIED',
    });
    expect(deps.analytics.events.map((e) => e.name)).toEqual([
      'Phone Challenge Created',
      'OTP Dispatch Updated',
    ]);
    expect(JSON.stringify(deps.analytics.events)).not.toContain('9000000001');
    expect(deps.audit.events.map((e) => e.action)).toEqual([
      'customer.provisional_created',
      'phone_challenge.created',
    ]);
  });

  it('returns the same shape for an existing customer and does not modify them', async () => {
    const { service, deps } = build();
    await service.create(cmd);
    const before = deps.customers.rows.get('cus_1');
    const r = await service.create(cmd);
    expect(r.phoneMasked).toBe('+91 ******0001');
    expect(deps.customers.rows.size).toBe(1);
    expect(deps.customers.rows.get('cus_1')).toBe(before);
  });

  it('marks DISPATCH_FAILED when the sender rejects or throws', async () => {
    const { service, deps } = build();
    deps.sms.send.mockResolvedValueOnce({ accepted: false });
    expect((await service.create(cmd)).status).toBe('DISPATCH_FAILED');
    deps.sms.send.mockRejectedValueOnce(new Error('gateway down'));
    expect((await service.create(cmd)).status).toBe('DISPATCH_FAILED');
    expect(
      deps.analytics.events
        .filter((e) => e.name === 'OTP Dispatch Updated')
        .map((e) => e.outcome),
    ).toEqual(['failed', 'failed']);
  });

  it('rate limits per phone (5) and per ip (20) with 429', async () => {
    const { service } = build();
    for (let i = 0; i < 5; i++) await service.create(cmd);
    await expect(service.create(cmd)).rejects.toBeInstanceOf(RateLimitedError);
    const { service: s2 } = build();
    for (let i = 0; i < 20; i++)
      await s2.create({ ...cmd, phone: `90000${String(i).padStart(5, '0')}` });
    await expect(
      s2.create({ ...cmd, phone: '9111111111' }),
    ).rejects.toBeInstanceOf(RateLimitedError);
  });

  it('rejects an invalid phone before any side effect', async () => {
    const { service, deps } = build();
    await expect(
      service.create({ ...cmd, phone: '12' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(deps.uow.runs).toBe(0);
  });
});

describe('PhoneChallengeService.verify', () => {
  it('verifies, creates the application, issues a session and revokes the pre-auth token', async () => {
    const { service, deps, fingerprint, sentOtp } = build();
    const created = await service.create(cmd);
    const fp = fingerprint.of('+919000000001', 'phone');
    const r = await service.verify({
      challengeId: created.challengeId,
      otp: sentOtp(),
      principalFingerprint: fp,
      preauthToken: created.preauthToken,
    });
    expect(r).toMatchObject({
      status: 'VERIFIED',
      customerId: 'cus_1',
      nextScreen: 'EMAIL_ENTRY',
    });
    expect(deps.customers.rows.get('cus_1')).toMatchObject({
      state: 'VERIFIED',
      version: 1,
    });
    expect(deps.applications.rows.get(r.applicationId)).toMatchObject({
      customerId: 'cus_1',
      status: 'IN_PROGRESS',
    });
    expect(deps.sessionStore.sessions.get(r.sessionToken)).toEqual({
      sessionId: expect.stringMatching(/^ses_/) as string,
      customerId: 'cus_1',
      applicationIds: [r.applicationId],
    });
    expect(deps.sessions.rows[0]).toMatchObject({ customerId: 'cus_1' });
    expect(deps.preauth.tokens.has(created.preauthToken)).toBe(false);
    expect(deps.challenges.rows.get(created.challengeId)?.status).toBe(
      'VERIFIED',
    );
    expect(deps.outbox.events.map((e) => e.eventType)).toEqual([
      'ApplicationCreated',
    ]);
    expect(deps.analytics.events.map((e) => e.name)).toContain(
      'Application Created',
    );
  });

  it('resumes the existing application on a second verification', async () => {
    const { service, deps, fingerprint, sentOtp } = build();
    const fp = fingerprint.of('+919000000001', 'phone');
    const c1 = await service.create(cmd);
    const first = await service.verify({
      challengeId: c1.challengeId,
      otp: sentOtp(),
      principalFingerprint: fp,
      preauthToken: c1.preauthToken,
    });
    const c2 = await service.create(cmd);
    const second = await service.verify({
      challengeId: c2.challengeId,
      otp: sentOtp(),
      principalFingerprint: fp,
      preauthToken: c2.preauthToken,
    });
    expect(second.applicationId).toBe(first.applicationId);
    expect(deps.outbox.events.map((e) => e.eventType)).toEqual([
      'ApplicationCreated',
      'ApplicationResumed',
    ]);
  });

  it.each([
    [
      'wrong otp',
      (o: string) => (o === '000000' ? '000001' : '000000'),
      'fp-ok',
    ],
    ['other phone fingerprint', (o: string) => o, 'fp-other'],
  ])(
    'rejects %s with OTP_INVALID_OR_EXPIRED and no session',
    async (_n, mutate, fpKind) => {
      const { service, deps, fingerprint, sentOtp } = build();
      const created = await service.create(cmd);
      const fp =
        fpKind === 'fp-ok'
          ? fingerprint.of('+919000000001', 'phone')
          : 'someone-else';
      await expect(
        service.verify({
          challengeId: created.challengeId,
          otp: mutate(sentOtp()),
          principalFingerprint: fp,
          preauthToken: created.preauthToken,
        }),
      ).rejects.toBeInstanceOf(OtpInvalidError);
      expect(deps.sessionStore.sessions.size).toBe(0);
      expect(deps.applications.rows.size).toBe(0);
    },
  );

  it('rejects unknown or consumed challenges', async () => {
    const { service, deps, fingerprint, sentOtp } = build();
    const fp = fingerprint.of('+919000000001', 'phone');
    await expect(
      service.verify({
        challengeId: 'ch_nope',
        otp: '123456',
        principalFingerprint: fp,
        preauthToken: 't',
      }),
    ).rejects.toBeInstanceOf(OtpInvalidError);
    const created = await service.create(cmd);
    const otp = sentOtp();
    await service.verify({
      challengeId: created.challengeId,
      otp,
      principalFingerprint: fp,
      preauthToken: created.preauthToken,
    });
    await expect(
      service.verify({
        challengeId: created.challengeId,
        otp,
        principalFingerprint: fp,
        preauthToken: created.preauthToken,
      }),
    ).rejects.toBeInstanceOf(OtpInvalidError);
    expect(deps.sessionStore.sessions.size).toBe(1);
  });

  it('two concurrent correct verifications yield exactly one session and one application', async () => {
    const { service, deps, fingerprint, sentOtp } = build();
    const fp = fingerprint.of('+919000000001', 'phone');
    const created = await service.create(cmd);
    const otp = sentOtp();
    const attempt = () =>
      service
        .verify({
          challengeId: created.challengeId,
          otp,
          principalFingerprint: fp,
          preauthToken: created.preauthToken,
        })
        .then(
          () => 'ok',
          (e: unknown) => (e instanceof OtpInvalidError ? 'invalid' : 'other'),
        );
    const results = await Promise.all([attempt(), attempt()]);
    expect(results.sort()).toEqual(['invalid', 'ok']);
    expect(deps.sessionStore.sessions.size).toBe(1);
    expect(deps.applications.rows.size).toBe(1);
  });

  it('fails closed (503) when the OTP store is unavailable and does not consume the challenge', async () => {
    const { service, deps, fingerprint, sentOtp } = build();
    const fp = fingerprint.of('+919000000001', 'phone');
    const created = await service.create(cmd);
    const otp = sentOtp();
    const original = deps.kv.incr.bind(deps.kv);
    deps.kv.incr = () => Promise.reject(new DependencyUnavailableError());
    await expect(
      service.verify({
        challengeId: created.challengeId,
        otp,
        principalFingerprint: fp,
        preauthToken: created.preauthToken,
      }),
    ).rejects.toBeInstanceOf(DependencyUnavailableError);
    deps.kv.incr = original;
    await expect(
      service.verify({
        challengeId: created.challengeId,
        otp,
        principalFingerprint: fp,
        preauthToken: created.preauthToken,
      }),
    ).resolves.toMatchObject({ status: 'VERIFIED' });
  });
});

describe('PhoneChallengeService.resend', () => {
  it('is rate limited inside the cooldown and keeps the old code valid', async () => {
    const { service, deps, fingerprint, sentOtp } = build();
    const fp = fingerprint.of('+919000000001', 'phone');
    const created = await service.create(cmd);
    const otp = sentOtp();
    deps.clock.advance(10_000);
    const err = (await service
      .resend({ challengeId: created.challengeId, principalFingerprint: fp })
      .catch((e: unknown) => e)) as RateLimitedError;
    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err.retryAfterSeconds).toBe(20);
    await expect(
      service.verify({
        challengeId: created.challengeId,
        otp,
        principalFingerprint: fp,
        preauthToken: created.preauthToken,
      }),
    ).resolves.toMatchObject({ status: 'VERIFIED' });
  });

  it('after the cooldown issues a new challenge, supersedes the old one and invalidates its code', async () => {
    const { service, deps, fingerprint, sentOtp } = build();
    const fp = fingerprint.of('+919000000001', 'phone');
    const created = await service.create(cmd);
    const oldOtp = sentOtp();
    deps.clock.advance(31_000);
    const r = await service.resend({
      challengeId: created.challengeId,
      principalFingerprint: fp,
    });
    expect(r).toMatchObject({
      status: 'DISPATCHED',
      expiresInSeconds: 300,
      resendAfterSeconds: 30,
    });
    expect(r.challengeId).not.toBe(created.challengeId);
    expect(deps.challenges.rows.get(created.challengeId)?.status).toBe(
      'SUPERSEDED',
    );
    await expect(
      service.verify({
        challengeId: created.challengeId,
        otp: oldOtp,
        principalFingerprint: fp,
        preauthToken: created.preauthToken,
      }),
    ).rejects.toBeInstanceOf(OtpInvalidError);
    await expect(
      service.verify({
        challengeId: r.challengeId,
        otp: sentOtp(),
        principalFingerprint: fp,
        preauthToken: created.preauthToken,
      }),
    ).resolves.toMatchObject({ status: 'VERIFIED' });
  });

  it('rejects resend for a challenge the principal does not own', async () => {
    const { service, deps } = build();
    const created = await service.create(cmd);
    deps.clock.advance(31_000);
    await expect(
      service.resend({
        challengeId: created.challengeId,
        principalFingerprint: 'other',
      }),
    ).rejects.toBeInstanceOf(OtpInvalidError);
  });
});

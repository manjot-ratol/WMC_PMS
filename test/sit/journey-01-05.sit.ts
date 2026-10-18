import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/infrastructure/persistence/prisma.service';
import { MessageSpy } from '../../src/infrastructure/messaging/message-spy';
import { startSitApp, type SitApp } from './setup/test-app';

interface Envelope {
  error: { code: string; message: string; retryable: boolean };
  request_id: string;
}
type Json = Record<string, unknown>;
const json = (res: { body: unknown }): Json => res.body as Json;
const errorCode = (res: { body: unknown }): string =>
  (res.body as Envelope).error.code;
const safe = (v: unknown) =>
  JSON.stringify(v, (_k, x: unknown) =>
    typeof x === 'bigint' ? x.toString() : x,
  );

/** Screens 01–05 end to end against the real app, docker postgres/redis, log SMS sender and Mailpit SMTP. */
describe('SIT: journey screens 01-05', () => {
  let sit: SitApp;
  let spy: MessageSpy;
  let prisma: PrismaService;
  const phone =
    '9' + String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0');
  const email = `sit-${randomUUID().slice(0, 8)}@example.com`;
  const idem = () => randomUUID();
  let preauth = '';
  let challengeId = '';
  let session = '';
  let applicationId = '';
  let emailChallengeId = '';

  beforeAll(async () => {
    sit = await startSitApp();
    spy = sit.app.get(MessageSpy);
    prisma = sit.app.get(PrismaService);
  });
  afterAll(() => sit.stop());

  it('01: creates a phone challenge and returns a pre-auth token', async () => {
    const res = await sit
      .http()
      .post('/v1/auth/phone/challenges')
      .set('Idempotency-Key', idem())
      .send({
        phone,
        purpose: 'PMS_ONBOARDING',
        privacy_notice_version: 'privacy_v1',
      })
      .expect(202);
    expect(json(res)).toMatchObject({
      status: 'DISPATCHED',
      expires_in_seconds: 300,
      resend_after_seconds: 30,
      phone_masked: `+91 ******${phone.slice(-4)}`,
    });
    preauth = json(res).preauth_token as string;
    challengeId = json(res).challenge_id as string;
    expect(JSON.stringify(res.body)).not.toMatch(/\d{6}"/);
    expect(spy.lastFor(`+91${phone}`)?.otp).toMatch(/^\d{6}$/);
  });

  it('01: the same Idempotency-Key replays the stored response without a second SMS', async () => {
    const key = idem();
    const body = {
      phone,
      purpose: 'PMS_ONBOARDING',
      privacy_notice_version: 'privacy_v1',
    };
    const first = await sit
      .http()
      .post('/v1/auth/phone/challenges')
      .set('Idempotency-Key', key)
      .send(body)
      .expect(202);
    const count = spy.messages.length;
    const replay = await sit
      .http()
      .post('/v1/auth/phone/challenges')
      .set('Idempotency-Key', key)
      .send(body)
      .expect(202);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(json(replay)).toEqual(json(first));
    expect(spy.messages.length).toBe(count);
    // continue with the newest challenge
    preauth = json(first).preauth_token as string;
    challengeId = json(first).challenge_id as string;
  });

  it('02: a wrong OTP is 422 OTP_INVALID_OR_EXPIRED; a missing pre-auth token is 401', async () => {
    const otp = spy.lastFor(`+91${phone}`)!.otp;
    const wrong = otp === '000000' ? '000001' : '000000';
    const res = await sit
      .http()
      .post(`/v1/auth/phone/challenges/${challengeId}/verify`)
      .set('Authorization', `Bearer ${preauth}`)
      .set('Idempotency-Key', idem())
      .send({ otp: wrong })
      .expect(422);
    expect(errorCode(res)).toBe('OTP_INVALID_OR_EXPIRED');
    await sit
      .http()
      .post(`/v1/auth/phone/challenges/${challengeId}/verify`)
      .set('Idempotency-Key', idem())
      .send({ otp })
      .expect(401);
  });

  it('02: resend inside the cooldown is 429 retryable', async () => {
    const res = await sit
      .http()
      .post(`/v1/auth/phone/challenges/${challengeId}/resend`)
      .set('Authorization', `Bearer ${preauth}`)
      .set('Idempotency-Key', idem())
      .send({})
      .expect(429);
    expect(json(res).error).toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
    });
  });

  it('02: the right OTP verifies, creates the application and issues a session', async () => {
    const otp = spy.lastFor(`+91${phone}`)!.otp;
    const res = await sit
      .http()
      .post(`/v1/auth/phone/challenges/${challengeId}/verify`)
      .set('Authorization', `Bearer ${preauth}`)
      .set('Idempotency-Key', idem())
      .send({ otp })
      .expect(200);
    expect(json(res)).toMatchObject({
      status: 'VERIFIED',
      next_screen: 'EMAIL_ENTRY',
    });
    session = json(res).session_token as string;
    applicationId = json(res).application_id as string;
    expect(session.length).toBeGreaterThan(30);
    // pre-auth token is now revoked
    await sit
      .http()
      .post(`/v1/auth/phone/challenges/${challengeId}/resend`)
      .set('Authorization', `Bearer ${preauth}`)
      .set('Idempotency-Key', idem())
      .send({})
      .expect(401);
  });

  it('resume read shows the completed phone step; another application id is 403', async () => {
    const res = await sit
      .http()
      .get(`/v1/onboarding/applications/${applicationId}`)
      .set('Authorization', `Bearer ${session}`)
      .expect(200);
    expect(json(res)).toMatchObject({
      application_id: applicationId,
      status: 'IN_PROGRESS',
      next_screen: 'EMAIL_ENTRY',
      journey_version: 'pms_v3',
    });
    expect(json(res).steps).toEqual([
      {
        step_id: 'PHONE_VERIFIED',
        status: 'COMPLETE',
        completed_at: expect.any(String) as string,
      },
    ]);
    await sit
      .http()
      .get('/v1/onboarding/applications/app_someone_else')
      .set('Authorization', `Bearer ${session}`)
      .expect(403);
    await sit
      .http()
      .get(`/v1/onboarding/applications/${applicationId}`)
      .expect(401);
  });

  it('05 before 03/04: eligibility is 422 ACTION_REQUIRED until the email is verified', async () => {
    const res = await sit
      .http()
      .put(`/v1/onboarding/applications/${applicationId}/eligibility`)
      .set('Authorization', `Bearer ${session}`)
      .set('Idempotency-Key', idem())
      .send({
        customer_type: 'INDIVIDUAL',
        residential_status: 'RESIDENT',
        intended_investment_inr: 5000000,
        distribution_route: 'DIRECT',
      })
      .expect(422);
    expect(errorCode(res)).toBe('ACTION_REQUIRED');
  });

  it('03: creates an email challenge delivered through SMTP (Mailpit)', async () => {
    const res = await sit
      .http()
      .post(`/v1/onboarding/applications/${applicationId}/email/challenges`)
      .set('Authorization', `Bearer ${session}`)
      .set('Idempotency-Key', idem())
      .send({ email })
      .expect(202);
    expect(json(res)).toMatchObject({
      status: 'DISPATCHED',
      email_masked: `s***@example.com`,
      expires_in_seconds: 300,
    });
    emailChallengeId = json(res).challenge_id as string;
    expect(spy.lastFor(email)?.otp).toMatch(/^\d{6}$/);
    const mailpit = await fetch(
      `http://localhost:8025/api/v1/search?query=to:${encodeURIComponent(email)}`,
    ).then((r) => r.json() as Promise<{ messages_count: number }>);
    expect(mailpit.messages_count).toBeGreaterThanOrEqual(1);
  });

  it('04: a phone OTP cannot verify the email; the email OTP does', async () => {
    const phoneOtp = spy.lastFor(`+91${phone}`)!.otp;
    await sit
      .http()
      .post(
        `/v1/onboarding/applications/${applicationId}/email/challenges/${challengeId}/verify`,
      )
      .set('Authorization', `Bearer ${session}`)
      .set('Idempotency-Key', idem())
      .send({ otp: phoneOtp })
      .expect(422);
    const res = await sit
      .http()
      .post(
        `/v1/onboarding/applications/${applicationId}/email/challenges/${emailChallengeId}/verify`,
      )
      .set('Authorization', `Bearer ${session}`)
      .set('Idempotency-Key', idem())
      .send({ otp: spy.lastFor(email)!.otp })
      .expect(200);
    expect(json(res)).toEqual({
      status: 'VERIFIED',
      next_screen: 'ELIGIBILITY',
    });
  });

  it('05: eligibility validation rejects bad input, then evaluates to ELIGIBLE', async () => {
    const bad = await sit
      .http()
      .put(`/v1/onboarding/applications/${applicationId}/eligibility`)
      .set('Authorization', `Bearer ${session}`)
      .set('Idempotency-Key', idem())
      .send({
        customer_type: 'INDIVIDUAL',
        residential_status: 'RESIDENT',
        intended_investment_inr: '5000000',
        distribution_route: 'DIRECT',
      })
      .expect(422);
    expect(errorCode(bad)).toBe('ACTION_REQUIRED');
    const res = await sit
      .http()
      .put(`/v1/onboarding/applications/${applicationId}/eligibility`)
      .set('Authorization', `Bearer ${session}`)
      .set('Idempotency-Key', idem())
      .send({
        customer_type: 'INDIVIDUAL',
        residential_status: 'RESIDENT',
        intended_investment_inr: 5000000,
        distribution_route: 'DIRECT',
      })
      .expect(200);
    expect(json(res)).toEqual({
      status: 'ELIGIBLE',
      ruleset_version: 'eligibility_v1',
      journey_route: 'RESIDENT_SINGLE_HOLDER',
      next_screen: 'PAN_IDENTITY',
    });
    const summary = await sit
      .http()
      .get(`/v1/onboarding/applications/${applicationId}`)
      .set('Authorization', `Bearer ${session}`)
      .expect(200);
    expect(json(summary).next_screen).toBe('PAN_IDENTITY');
    const steps = json(summary).steps as { step_id: string }[];
    expect(steps.map((s) => s.step_id).sort()).toEqual([
      'ELIGIBILITY',
      'EMAIL_VERIFIED',
      'PHONE_VERIFIED',
    ]);
  });

  it('privacy: analytics outbox and audit rows contain no phone, email or OTP', async () => {
    const rows = await prisma.analyticsOutbox.findMany({
      where: {
        properties: { path: ['application_id'], equals: applicationId },
      },
    });
    expect(rows.map((r) => r.eventName)).toEqual(
      expect.arrayContaining([
        'Phone Verification Completed',
        'Application Created',
        'Email Challenge Created',
        'Email Verification Completed',
        'Eligibility Evaluation Completed',
      ]),
    );
    const blob =
      safe(rows) +
      safe(
        await prisma.auditEvent.findMany({
          where: { aggregateId: applicationId },
        }),
      );
    expect(blob).not.toContain(phone);
    expect(blob).not.toContain(email);
    for (const m of spy.messages) expect(blob).not.toContain(m.otp);
  });

  it('abuse: the sixth phone challenge for one number inside the window is 429', async () => {
    const other =
      '8' + String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0');
    for (let i = 0; i < 5; i++)
      await sit
        .http()
        .post('/v1/auth/phone/challenges')
        .set('Idempotency-Key', idem())
        .send({
          phone: other,
          purpose: 'PMS_ONBOARDING',
          privacy_notice_version: 'privacy_v1',
        })
        .expect(202);
    const res = await sit
      .http()
      .post('/v1/auth/phone/challenges')
      .set('Idempotency-Key', idem())
      .send({
        phone: other,
        purpose: 'PMS_ONBOARDING',
        privacy_notice_version: 'privacy_v1',
      })
      .expect(429);
    expect(json(res).error).toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
    });
  });
});

import { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

const errorCode = (res: { body: unknown }): string =>
  (res.body as { error: { code: string } }).error.code;
import { PhoneChallengeService } from '../../application/auth/phone-challenge.service';
import { ApplicationQueryService } from '../../application/onboarding/application-query.service';
import { EligibilityService } from '../../application/onboarding/eligibility.service';
import { EmailVerificationService } from '../../application/onboarding/email-verification.service';
import { ApplicationOwnershipGuard } from '../../common/auth/application-ownership.guard';
import { PreAuthGuard } from '../../common/auth/preauth.guard';
import { SessionGuard } from '../../common/auth/session.guard';
import { CorrelationStore } from '../../common/correlation/correlation.store';
import { ErrorEnvelopeFilter } from '../../common/errors/error-envelope.filter';
import { createValidationPipe } from '../../common/validation/validation.pipe';
import { PhoneChallengeController } from './auth/phone-challenge.controller';
import { ApplicationController } from './onboarding/application.controller';
import { EmailChallengeController } from './onboarding/email-challenge.controller';

describe('Phase 2 controllers (mocked services and guards)', () => {
  let app: INestApplication<App>;
  const phone = { create: jest.fn(), verify: jest.fn(), resend: jest.fn() };
  const email = { create: jest.fn(), verify: jest.fn(), resend: jest.fn() };
  const eligibility = { evaluate: jest.fn() };
  const query = { get: jest.fn() };
  const asCustomer = {
    canActivate: (ctx: {
      switchToHttp: () => { getRequest: () => { principal?: unknown } };
    }) => {
      ctx.switchToHttp().getRequest().principal = {
        kind: 'CUSTOMER',
        id: 'cus_1',
        applicationIds: ['app_1'],
      };
      return true;
    },
  };
  const asPreauth = {
    canActivate: (ctx: {
      switchToHttp: () => {
        getRequest: () => { principal?: unknown; preauthToken?: string };
      };
    }) => {
      const r = ctx.switchToHttp().getRequest();
      r.principal = { kind: 'PREAUTH', id: 'fp1' };
      r.preauthToken = 'pa-token';
      return true;
    },
  };

  beforeAll(async () => {
    const logger = { error: jest.fn(), warn: jest.fn(), child: jest.fn() };
    const mod = await Test.createTestingModule({
      controllers: [
        PhoneChallengeController,
        EmailChallengeController,
        ApplicationController,
      ],
      providers: [
        { provide: PhoneChallengeService, useValue: phone },
        { provide: EmailVerificationService, useValue: email },
        { provide: EligibilityService, useValue: eligibility },
        { provide: ApplicationQueryService, useValue: query },
        CorrelationStore,
        {
          provide: APP_FILTER,
          useFactory: (s: CorrelationStore) =>
            new ErrorEnvelopeFilter(s, logger as never),
          inject: [CorrelationStore],
        },
        { provide: APP_PIPE, useFactory: createValidationPipe },
      ],
    })
      .overrideGuard(SessionGuard)
      .useValue(asCustomer)
      .overrideGuard(PreAuthGuard)
      .useValue(asPreauth)
      .overrideGuard(ApplicationOwnershipGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = mod.createNestApplication<App>();
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('POST /v1/auth/phone/challenges maps the body and returns 202 in the spec shape', async () => {
    phone.create.mockResolvedValue({
      challengeId: 'ch_1',
      status: 'DISPATCHED',
      expiresInSeconds: 300,
      resendAfterSeconds: 30,
      phoneMasked: '+91 ******0001',
      preauthToken: 'pa',
    });
    const res = await request(app.getHttpServer())
      .post('/v1/auth/phone/challenges')
      .send({
        phone: '9000000001',
        purpose: 'PMS_ONBOARDING',
        privacy_notice_version: 'privacy_v1',
      })
      .expect(202);
    expect(res.body).toEqual({
      challenge_id: 'ch_1',
      status: 'DISPATCHED',
      expires_in_seconds: 300,
      resend_after_seconds: 30,
      phone_masked: '+91 ******0001',
      preauth_token: 'pa',
    });
    expect(phone.create).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '9000000001',
        purpose: 'PMS_ONBOARDING',
        privacyNoticeVersion: 'privacy_v1',
        clientIp: expect.any(String) as string,
      }),
    );
  });

  it('rejects unknown purpose and extra fields with 422', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/phone/challenges')
      .send({
        phone: '9000000001',
        purpose: 'OTHER',
        privacy_notice_version: 'x',
        extra: 1,
      })
      .expect(422);
    expect(errorCode(res)).toBe('ACTION_REQUIRED');
    expect(phone.create).not.toHaveBeenCalled();
  });

  it('verify and resend pass the pre-auth principal and token', async () => {
    phone.verify.mockResolvedValue({
      status: 'VERIFIED',
      customerId: 'cus_1',
      applicationId: 'app_1',
      nextScreen: 'EMAIL_ENTRY',
      sessionToken: 'st',
    });
    const v = await request(app.getHttpServer())
      .post('/v1/auth/phone/challenges/ch_1/verify')
      .send({ otp: '123456' })
      .expect(200);
    expect(v.body).toEqual({
      status: 'VERIFIED',
      customer_id: 'cus_1',
      application_id: 'app_1',
      next_screen: 'EMAIL_ENTRY',
      session_token: 'st',
    });
    expect(phone.verify).toHaveBeenCalledWith({
      challengeId: 'ch_1',
      otp: '123456',
      principalFingerprint: 'fp1',
      preauthToken: 'pa-token',
    });
    await request(app.getHttpServer())
      .post('/v1/auth/phone/challenges/ch_1/verify')
      .send({ otp: '12' })
      .expect(422);
    phone.resend.mockResolvedValue({
      challengeId: 'ch_2',
      status: 'DISPATCHED',
      expiresInSeconds: 300,
      resendAfterSeconds: 30,
    });
    const r = await request(app.getHttpServer())
      .post('/v1/auth/phone/challenges/ch_1/resend')
      .send({})
      .expect(200);
    expect(r.body).toEqual({
      challenge_id: 'ch_2',
      status: 'DISPATCHED',
      expires_in_seconds: 300,
      resend_after_seconds: 30,
    });
  });

  it('email endpoints use the session principal and application path param', async () => {
    email.create.mockResolvedValue({
      challengeId: 'ech_1',
      status: 'DISPATCHED',
      emailMasked: 'c***@example.com',
      expiresInSeconds: 300,
    });
    const c = await request(app.getHttpServer())
      .post('/v1/onboarding/applications/app_1/email/challenges')
      .send({ email: 'c@example.com' })
      .expect(202);
    expect(c.body).toEqual({
      challenge_id: 'ech_1',
      status: 'DISPATCHED',
      email_masked: 'c***@example.com',
      expires_in_seconds: 300,
    });
    expect(email.create).toHaveBeenCalledWith({
      applicationId: 'app_1',
      customerId: 'cus_1',
      email: 'c@example.com',
    });
    email.verify.mockResolvedValue({
      status: 'VERIFIED',
      nextScreen: 'ELIGIBILITY',
    });
    const v = await request(app.getHttpServer())
      .post('/v1/onboarding/applications/app_1/email/challenges/ech_1/verify')
      .send({ otp: '123456' })
      .expect(200);
    expect(v.body).toEqual({ status: 'VERIFIED', next_screen: 'ELIGIBILITY' });
    email.resend.mockResolvedValue({
      challengeId: 'ech_2',
      status: 'DISPATCHED',
    });
    const r = await request(app.getHttpServer())
      .post('/v1/onboarding/applications/app_1/email/challenges/ech_1/resend')
      .send({})
      .expect(200);
    expect(r.body).toEqual({ challenge_id: 'ech_2', status: 'DISPATCHED' });
  });

  it('eligibility validates enums and integers and maps the decision; GET returns the summary', async () => {
    await request(app.getHttpServer())
      .put('/v1/onboarding/applications/app_1/eligibility')
      .send({
        customer_type: 'TRUST',
        residential_status: 'RESIDENT',
        intended_investment_inr: 1,
        distribution_route: 'DIRECT',
      })
      .expect(422);
    await request(app.getHttpServer())
      .put('/v1/onboarding/applications/app_1/eligibility')
      .send({
        customer_type: 'INDIVIDUAL',
        residential_status: 'RESIDENT',
        intended_investment_inr: 10.5,
        distribution_route: 'DIRECT',
      })
      .expect(422);
    eligibility.evaluate.mockResolvedValue({
      status: 'ELIGIBLE',
      rulesetVersion: 'eligibility_v1',
      journeyRoute: 'RESIDENT_SINGLE_HOLDER',
      reasons: [],
      nextScreen: 'PAN_IDENTITY',
    });
    const res = await request(app.getHttpServer())
      .put('/v1/onboarding/applications/app_1/eligibility')
      .send({
        customer_type: 'INDIVIDUAL',
        residential_status: 'RESIDENT',
        intended_investment_inr: 5000000,
        distribution_route: 'DIRECT',
      })
      .expect(200);
    expect(res.body).toEqual({
      status: 'ELIGIBLE',
      ruleset_version: 'eligibility_v1',
      journey_route: 'RESIDENT_SINGLE_HOLDER',
      next_screen: 'PAN_IDENTITY',
    });
    expect(eligibility.evaluate).toHaveBeenCalledWith('app_1', 'cus_1', {
      customerType: 'INDIVIDUAL',
      residentialStatus: 'RESIDENT',
      intendedInvestmentInr: 5000000,
      distributionRoute: 'DIRECT',
    });
    query.get.mockResolvedValue({
      applicationId: 'app_1',
      status: 'IN_PROGRESS',
      nextScreen: 'ELIGIBILITY',
      version: 1,
      journeyVersion: 'pms_v3',
      steps: [
        {
          stepId: 'PHONE_VERIFIED',
          status: 'COMPLETE',
          completedAt: new Date('2026-10-18T00:00:00Z'),
        },
      ],
    });
    const g = await request(app.getHttpServer())
      .get('/v1/onboarding/applications/app_1')
      .expect(200);
    expect(g.body).toEqual({
      application_id: 'app_1',
      status: 'IN_PROGRESS',
      next_screen: 'ELIGIBILITY',
      version: 1,
      journey_version: 'pms_v3',
      steps: [
        {
          step_id: 'PHONE_VERIFIED',
          status: 'COMPLETE',
          completed_at: '2026-10-18T00:00:00.000Z',
        },
      ],
    });
  });
});

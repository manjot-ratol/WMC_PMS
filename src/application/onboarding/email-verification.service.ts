import { Inject, Injectable } from '@nestjs/common';
import { authConfig } from '../../common/config/auth.config';
import { Fingerprint } from '../../common/crypto/fingerprint';
import {
  NotFoundError,
  OtpInvalidError,
  RateLimitedError,
  ValidationError,
} from '../../common/errors/app-error';
import { AppLogger } from '../../common/logging/logger.service';
import {
  canResend,
  newChallenge,
  secondsUntil,
  withStatus,
  type Challenge,
  type OtpPolicy,
} from '../../domain/identity/challenge';
import { proposeEmail, verifyEmail } from '../../domain/identity/customer';
import {
  completeStep,
  requireStep,
  type OnboardingApplication,
} from '../../domain/onboarding/application';
import {
  maskEmail,
  normaliseEmail,
  type EmailAddress,
} from '../../domain/shared/email-address';
import { ID_PREFIX } from '../../domain/shared/public-id';
import { RATE_LIMITS } from '../auth/rate-limits';
import { OtpService } from '../auth/otp.service';
import { ANALYTICS, type AnalyticsPort } from '../ports/analytics.port';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepositoryPort,
} from '../ports/application.repository.port';
import { AUDIT, type AuditPort } from '../ports/audit.port';
import {
  CHALLENGE_REPOSITORY,
  type ChallengeRepositoryPort,
} from '../ports/challenge.repository.port';
import { CLOCK, type ClockPort } from '../ports/clock.port';
import {
  CUSTOMER_REPOSITORY,
  type CustomerRepositoryPort,
} from '../ports/customer.repository.port';
import { EMAIL_SENDER, type EmailSenderPort } from '../ports/email-sender.port';
import { ID_GENERATOR, type IdGeneratorPort } from '../ports/id-generator.port';
import { OUTBOX, type OutboxPort } from '../ports/outbox.port';
import { RATE_LIMITER, type RateLimiterPort } from '../ports/rate-limiter.port';
import { UNIT_OF_WORK, type UnitOfWork } from '../ports/unit-of-work.port';

export interface CreateEmailChallengeCommand {
  applicationId: string;
  customerId: string;
  email: string;
}
export interface EmailChallengeCreated {
  challengeId: string;
  status: Challenge['status'];
  emailMasked: string;
  expiresInSeconds: number;
}
export interface VerifyEmailCommand {
  applicationId: string;
  customerId: string;
  challengeId: string;
  otp: string;
}

const SCREEN_EMAIL = '03';
const SCREEN_EMAIL_OTP = '04';

@Injectable()
export class EmailVerificationService {
  private readonly policy: OtpPolicy;
  private readonly logger: AppLogger;

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CUSTOMER_REPOSITORY)
    private readonly customers: CustomerRepositoryPort,
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
    @Inject(CHALLENGE_REPOSITORY)
    private readonly challenges: ChallengeRepositoryPort,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiterPort,
    @Inject(EMAIL_SENDER) private readonly email: EmailSenderPort,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
    @Inject(ANALYTICS) private readonly analytics: AnalyticsPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    @Inject(authConfig.KEY) cfg: ReturnType<typeof authConfig>,
    private readonly fingerprint: Fingerprint,
    private readonly otp: OtpService,
    logger: AppLogger,
  ) {
    this.policy = {
      ttlSeconds: cfg.otpTtlSeconds,
      resendAfterSeconds: cfg.otpResendAfterSeconds,
      maxAttempts: cfg.otpMaxAttempts,
    };
    this.logger = logger.child('EmailVerificationService');
  }

  async create(
    cmd: CreateEmailChallengeCommand,
  ): Promise<EmailChallengeCreated> {
    const email = normaliseEmail(cmd.email);
    const app = await this.loadApplication(cmd.applicationId, cmd.customerId);
    requireStep(app, 'PHONE_VERIFIED');
    const decision = await this.limiter.consume(
      RATE_LIMITS.emailChallengePerApplication.scope,
      app.id,
      RATE_LIMITS.emailChallengePerApplication.limit,
      RATE_LIMITS.emailChallengePerApplication.windowSeconds,
    );
    if (!decision.allowed)
      throw new RateLimitedError(decision.retryAfterSeconds);
    const now = this.clock.now();
    const fp = this.fingerprint.of(email, 'email');

    const { challenge, superseded } = await this.uow.run(async (tx) => {
      const customer = await this.customers.findById(cmd.customerId, tx);
      if (!customer) throw new NotFoundError();
      const proposed = proposeEmail(customer, email);
      if (proposed !== customer)
        await this.customers.saveWithVersionCheck(
          proposed,
          customer.version,
          tx,
        );
      const pending = await this.challenges.findPendingByApplication(
        app.id,
        'EMAIL',
        tx,
      );
      for (const p of pending)
        await this.challenges.update(withStatus(p, 'SUPERSEDED'), tx);
      const ch = newChallenge(
        {
          id: this.ids.prefixed(ID_PREFIX.emailChallenge),
          channel: 'EMAIL',
          purpose: 'EMAIL_VERIFICATION',
          targetFingerprint: fp,
          customerId: customer.id,
          applicationId: app.id,
        },
        this.policy,
        now,
      );
      await this.challenges.create(ch, tx);
      await this.audit.append(
        {
          actorType: 'CUSTOMER',
          actorId: customer.id,
          action: 'email_challenge.created',
          aggregateType: 'challenge',
          aggregateId: ch.id,
          details: { applicationId: app.id },
        },
        tx,
      );
      await this.analytics.track(
        {
          name: 'Email Challenge Created',
          identity: customer.id,
          applicationId: app.id,
          screenId: SCREEN_EMAIL,
          outcome: 'created',
        },
        tx,
      );
      return { challenge: ch, superseded: pending };
    });
    for (const p of superseded) await this.otp.supersede(p);
    const dispatched = await this.dispatch(challenge, email);
    return {
      challengeId: dispatched.id,
      status: dispatched.status,
      emailMasked: maskEmail(email),
      expiresInSeconds: secondsUntil(dispatched.expiresAt, now),
    };
  }

  async verify(
    cmd: VerifyEmailCommand,
  ): Promise<{ status: 'VERIFIED'; nextScreen: string }> {
    const now = this.clock.now();
    const challenge = await this.loadOwned(cmd);
    const result = await this.otp.verify(challenge, cmd.otp, now);
    if (result !== 'OK') {
      this.logger.info('email_challenge.verify_failed', {
        challengeId: challenge.id,
        result,
      });
      throw new OtpInvalidError(undefined, { details: { result } });
    }
    return this.uow.run(async (tx) => {
      const customer = await this.customers.findById(cmd.customerId, tx);
      const app = await this.applications.findById(cmd.applicationId, tx);
      if (
        !customer ||
        !app ||
        !customer.email ||
        this.fingerprint.of(customer.email, 'email') !==
          challenge.targetFingerprint
      )
        throw new OtpInvalidError();
      const verified = verifyEmail(customer, customer.email, now);
      if (verified !== customer)
        await this.customers.saveWithVersionCheck(
          verified,
          customer.version,
          tx,
        );
      const advanced = completeStep(app, 'EMAIL_VERIFIED', 'ELIGIBILITY', now);
      if (advanced !== app)
        await this.applications.saveWithVersionCheck(advanced, app.version, tx);
      await this.challenges.update(withStatus(challenge, 'VERIFIED', now), tx);
      await this.audit.append(
        {
          actorType: 'CUSTOMER',
          actorId: customer.id,
          action: 'email.verified',
          aggregateType: 'application',
          aggregateId: app.id,
          details: { challengeId: challenge.id },
        },
        tx,
      );
      await this.outbox.add(
        {
          aggregateType: 'application',
          aggregateId: app.id,
          eventType: 'StepCompleted',
          payload: { stepId: 'EMAIL_VERIFIED' },
        },
        tx,
      );
      await this.analytics.track(
        {
          name: 'Email Verification Completed',
          identity: customer.id,
          applicationId: app.id,
          screenId: SCREEN_EMAIL_OTP,
          outcome: 'verified',
        },
        tx,
      );
      return { status: 'VERIFIED' as const, nextScreen: advanced.nextScreen };
    });
  }

  async resend(
    cmd: Omit<VerifyEmailCommand, 'otp'>,
  ): Promise<{ challengeId: string; status: Challenge['status'] }> {
    const now = this.clock.now();
    const old = await this.loadOwned(cmd);
    const window = canResend(old, now);
    if (!window.allowed) throw new RateLimitedError(window.retryAfterSeconds);
    const customer = await this.customers.findById(cmd.customerId);
    if (!customer?.email) throw new OtpInvalidError();
    const email = customer.email;
    const fresh = await this.uow.run(async (tx) => {
      await this.challenges.update(withStatus(old, 'SUPERSEDED'), tx);
      const ch = newChallenge(
        {
          id: this.ids.prefixed(ID_PREFIX.emailChallenge),
          channel: 'EMAIL',
          purpose: 'EMAIL_VERIFICATION',
          targetFingerprint: old.targetFingerprint,
          customerId: old.customerId,
          applicationId: old.applicationId,
        },
        this.policy,
        now,
      );
      await this.challenges.create(ch, tx);
      await this.audit.append(
        {
          actorType: 'CUSTOMER',
          actorId: customer.id,
          action: 'email_challenge.resent',
          aggregateType: 'challenge',
          aggregateId: ch.id,
          details: { supersedes: old.id },
        },
        tx,
      );
      await this.analytics.track(
        {
          name: 'Email Challenge Created',
          identity: customer.id,
          applicationId: cmd.applicationId,
          screenId: SCREEN_EMAIL_OTP,
          outcome: 'resent',
        },
        tx,
      );
      return ch;
    });
    await this.otp.supersede(old);
    const dispatched = await this.dispatch(fresh, email);
    return { challengeId: dispatched.id, status: dispatched.status };
  }

  private async loadApplication(
    applicationId: string,
    customerId: string,
  ): Promise<OnboardingApplication> {
    const app = await this.applications.findById(applicationId);
    if (!app || app.customerId !== customerId) throw new NotFoundError();
    if (app.status !== 'IN_PROGRESS')
      throw new ValidationError(undefined, {
        details: { applicationStatus: app.status },
      });
    return app;
  }

  private async loadOwned(cmd: {
    applicationId: string;
    customerId: string;
    challengeId: string;
  }): Promise<Challenge> {
    const ch = await this.challenges.findById(cmd.challengeId);
    if (
      !ch ||
      ch.channel !== 'EMAIL' ||
      ch.applicationId !== cmd.applicationId ||
      ch.customerId !== cmd.customerId ||
      ch.status === 'VERIFIED' ||
      ch.status === 'SUPERSEDED'
    ) {
      throw new OtpInvalidError();
    }
    return ch;
  }

  private async dispatch(
    challenge: Challenge,
    email: EmailAddress,
  ): Promise<Challenge> {
    const otp = await this.otp.create(challenge, this.policy);
    let accepted = false;
    try {
      accepted = (
        await this.email.send(email, {
          template: 'OTP',
          vars: {
            otp,
            expiresInMinutes: Math.ceil(this.policy.ttlSeconds / 60),
          },
        })
      ).accepted;
    } catch (err) {
      this.logger.warn('email.dispatch_error', {
        challengeId: challenge.id,
        err,
      });
    }
    const updated = withStatus(
      challenge,
      accepted ? 'DISPATCHED' : 'DISPATCH_FAILED',
    );
    await this.uow.run(async (tx) => {
      await this.challenges.update(updated, tx);
      await this.analytics.track(
        {
          name: 'Email Dispatch Updated',
          applicationId: challenge.applicationId,
          screenId: SCREEN_EMAIL,
          outcome: accepted ? 'accepted' : 'failed',
          safeErrorCategory: accepted ? undefined : 'delivery',
        },
        tx,
      );
    });
    return updated;
  }
}

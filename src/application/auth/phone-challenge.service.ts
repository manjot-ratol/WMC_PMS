import { Inject, Injectable } from '@nestjs/common';
import { authConfig } from '../../common/config/auth.config';
import { Fingerprint } from '../../common/crypto/fingerprint';
import {
  OtpInvalidError,
  RateLimitedError,
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
import {
  newProvisionalCustomer,
  verifyPhone,
} from '../../domain/identity/customer';
import {
  maskPhone,
  normalisePhone,
  type PhoneNumber,
} from '../../domain/shared/phone-number';
import { ID_PREFIX } from '../../domain/shared/public-id';
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
import { ID_GENERATOR, type IdGeneratorPort } from '../ports/id-generator.port';
import { OUTBOX, type OutboxPort } from '../ports/outbox.port';
import { RATE_LIMITER, type RateLimiterPort } from '../ports/rate-limiter.port';
import {
  SESSION_REPOSITORY,
  type SessionRepositoryPort,
} from '../ports/session.repository.port';
import { SMS_SENDER, type SmsSenderPort } from '../ports/sms-sender.port';
import {
  hashToken,
  PREAUTH_TOKEN_STORE,
  SESSION_STORE,
  type PreAuthTokenStore,
  type SessionStore,
} from '../ports/token-store.port';
import { UNIT_OF_WORK, type UnitOfWork } from '../ports/unit-of-work.port';
import { ApplicationLifecycleService } from '../onboarding/application-lifecycle.service';
import { OtpService } from './otp.service';
import { RATE_LIMITS } from './rate-limits';

export interface CreatePhoneChallengeCommand {
  phone: string;
  purpose: 'PMS_ONBOARDING';
  privacyNoticeVersion: string;
  clientIp: string;
}
export interface PhoneChallengeCreated {
  challengeId: string;
  status: Challenge['status'];
  expiresInSeconds: number;
  resendAfterSeconds: number;
  phoneMasked: string;
  preauthToken: string;
}
export interface VerifyPhoneCommand {
  challengeId: string;
  otp: string;
  /** Phone fingerprint bound to the pre-auth token (PREAUTH principal id). */
  principalFingerprint: string;
  preauthToken: string;
}
export interface PhoneVerified {
  status: 'VERIFIED';
  customerId: string;
  applicationId: string;
  nextScreen: string;
  sessionToken: string;
}
export interface ResendPhoneCommand {
  challengeId: string;
  principalFingerprint: string;
}
export interface PhoneChallengeResent {
  challengeId: string;
  status: Challenge['status'];
  expiresInSeconds: number;
  resendAfterSeconds: number;
}

const SCREEN_PHONE = '01';
const SCREEN_OTP = '02';

@Injectable()
export class PhoneChallengeService {
  private readonly policy: OtpPolicy;
  private readonly logger: AppLogger;

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CUSTOMER_REPOSITORY)
    private readonly customers: CustomerRepositoryPort,
    @Inject(CHALLENGE_REPOSITORY)
    private readonly challenges: ChallengeRepositoryPort,
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
    @Inject(SESSION_REPOSITORY)
    private readonly sessions: SessionRepositoryPort,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiterPort,
    @Inject(SMS_SENDER) private readonly sms: SmsSenderPort,
    @Inject(PREAUTH_TOKEN_STORE) private readonly preauth: PreAuthTokenStore,
    @Inject(SESSION_STORE) private readonly sessionStore: SessionStore,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
    @Inject(ANALYTICS) private readonly analytics: AnalyticsPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    @Inject(authConfig.KEY) cfg: ReturnType<typeof authConfig>,
    private readonly fingerprint: Fingerprint,
    private readonly otp: OtpService,
    private readonly lifecycle: ApplicationLifecycleService,
    logger: AppLogger,
  ) {
    this.policy = {
      ttlSeconds: cfg.otpTtlSeconds,
      resendAfterSeconds: cfg.otpResendAfterSeconds,
      maxAttempts: cfg.otpMaxAttempts,
    };
    this.sessionTtlSeconds = cfg.sessionTtlSeconds;
    this.logger = logger.child('PhoneChallengeService');
  }
  private readonly sessionTtlSeconds: number;

  async create(
    cmd: CreatePhoneChallengeCommand,
  ): Promise<PhoneChallengeCreated> {
    const phone = normalisePhone(cmd.phone);
    const fp = this.fingerprint.of(phone, 'phone');
    await this.enforce(RATE_LIMITS.phoneChallengePerPhone, fp);
    await this.enforce(
      RATE_LIMITS.phoneChallengePerIp,
      this.fingerprint.of(cmd.clientIp, 'otp'),
    );
    const now = this.clock.now();

    const challenge = await this.uow.run(async (tx) => {
      let customer = await this.customers.findByPhoneFingerprint(fp, tx);
      if (!customer) {
        customer = newProvisionalCustomer(
          this.ids.prefixed(ID_PREFIX.customer),
          phone,
          now,
        );
        await this.customers.create(customer, tx);
        await this.audit.append(
          {
            actorType: 'SYSTEM',
            action: 'customer.provisional_created',
            aggregateType: 'customer',
            aggregateId: customer.id,
          },
          tx,
        );
      }
      const ch = newChallenge(
        {
          id: this.ids.prefixed(ID_PREFIX.phoneChallenge),
          channel: 'PHONE',
          purpose: cmd.purpose,
          targetFingerprint: fp,
          customerId: customer.id,
        },
        this.policy,
        now,
      );
      await this.challenges.create(ch, tx);
      await this.audit.append(
        {
          actorType: 'CUSTOMER',
          actorId: customer.id,
          action: 'phone_challenge.created',
          aggregateType: 'challenge',
          aggregateId: ch.id,
          details: { privacyNoticeVersion: cmd.privacyNoticeVersion },
        },
        tx,
      );
      await this.analytics.track(
        {
          name: 'Phone Challenge Created',
          screenId: SCREEN_PHONE,
          outcome: 'created',
        },
        tx,
      );
      return ch;
    });

    const dispatched = await this.dispatch(challenge, phone);
    const preauthToken = await this.preauth.issue({
      purpose: cmd.purpose,
      phoneFingerprint: fp,
    });
    return {
      challengeId: dispatched.id,
      status: dispatched.status,
      expiresInSeconds: secondsUntil(dispatched.expiresAt, now),
      resendAfterSeconds: secondsUntil(dispatched.resendAfter, now),
      phoneMasked: maskPhone(phone),
      preauthToken,
    };
  }

  async verify(cmd: VerifyPhoneCommand): Promise<PhoneVerified> {
    const now = this.clock.now();
    const challenge = await this.loadOwned(
      cmd.challengeId,
      cmd.principalFingerprint,
    );
    const result = await this.otp.verify(challenge, cmd.otp, now);
    if (result !== 'OK') {
      this.logger.info('phone_challenge.verify_failed', {
        challengeId: challenge.id,
        result,
      });
      throw new OtpInvalidError(undefined, { details: { result } });
    }

    const outcome = await this.uow.run(async (tx) => {
      const current = await this.customers.findById(challenge.customerId!, tx);
      if (!current) throw new OtpInvalidError();
      const verified = verifyPhone(current, now);
      if (verified !== current)
        await this.customers.saveWithVersionCheck(
          verified,
          current.version,
          tx,
        );
      const { application, created } = await this.lifecycle.createOrResume(
        current.id,
        now,
        tx,
      );
      await this.challenges.update(withStatus(challenge, 'VERIFIED', now), tx);
      await this.audit.append(
        {
          actorType: 'CUSTOMER',
          actorId: current.id,
          action: 'phone.verified',
          aggregateType: 'customer',
          aggregateId: current.id,
          details: { challengeId: challenge.id },
        },
        tx,
      );
      await this.outbox.add(
        {
          aggregateType: 'application',
          aggregateId: application.id,
          eventType: created ? 'ApplicationCreated' : 'ApplicationResumed',
          payload: { customerId: current.id },
        },
        tx,
      );
      await this.analytics.track(
        {
          name: 'Phone Verification Completed',
          identity: current.id,
          applicationId: application.id,
          screenId: SCREEN_OTP,
          outcome: 'verified',
        },
        tx,
      );
      await this.analytics.track(
        {
          name: created ? 'Application Created' : 'Application Resumed',
          identity: current.id,
          applicationId: application.id,
          screenId: SCREEN_OTP,
        },
        tx,
      );
      return {
        customerId: current.id,
        applicationId: application.id,
        nextScreen: application.nextScreen,
      };
    });

    const applicationIds = await this.applications.listIdsByCustomer(
      outcome.customerId,
    );
    const sessionId = this.ids.prefixed(ID_PREFIX.session);
    const sessionToken = await this.sessionStore.issue({
      sessionId,
      customerId: outcome.customerId,
      applicationIds,
    });
    await this.sessions.create({
      id: sessionId,
      tokenHash: hashToken(sessionToken),
      customerId: outcome.customerId,
      expiresAt: new Date(now.getTime() + this.sessionTtlSeconds * 1000),
    });
    await this.preauth.revoke(cmd.preauthToken);
    return { status: 'VERIFIED', ...outcome, sessionToken };
  }

  async resend(cmd: ResendPhoneCommand): Promise<PhoneChallengeResent> {
    const now = this.clock.now();
    const old = await this.loadOwned(cmd.challengeId, cmd.principalFingerprint);
    const window = canResend(old, now);
    if (!window.allowed) throw new RateLimitedError(window.retryAfterSeconds);
    await this.enforce(
      RATE_LIMITS.phoneChallengePerPhone,
      old.targetFingerprint,
    );
    const customer = await this.customers.findById(old.customerId!);
    if (!customer) throw new OtpInvalidError();

    const fresh = await this.uow.run(async (tx) => {
      await this.challenges.update(withStatus(old, 'SUPERSEDED'), tx);
      const ch = newChallenge(
        {
          id: this.ids.prefixed(ID_PREFIX.phoneChallenge),
          channel: 'PHONE',
          purpose: old.purpose,
          targetFingerprint: old.targetFingerprint,
          customerId: old.customerId,
        },
        this.policy,
        now,
      );
      await this.challenges.create(ch, tx);
      await this.audit.append(
        {
          actorType: 'CUSTOMER',
          actorId: customer.id,
          action: 'phone_challenge.resent',
          aggregateType: 'challenge',
          aggregateId: ch.id,
          details: { supersedes: old.id },
        },
        tx,
      );
      await this.analytics.track(
        {
          name: 'Phone Challenge Created',
          screenId: SCREEN_OTP,
          outcome: 'resent',
        },
        tx,
      );
      return ch;
    });
    await this.otp.supersede(old);
    const dispatched = await this.dispatch(fresh, customer.phone);
    return {
      challengeId: dispatched.id,
      status: dispatched.status,
      expiresInSeconds: secondsUntil(dispatched.expiresAt, now),
      resendAfterSeconds: secondsUntil(dispatched.resendAfter, now),
    };
  }

  /** Loads a phone challenge the pre-auth principal is allowed to act on; anything else is an invalid code. */
  private async loadOwned(
    challengeId: string,
    principalFingerprint: string,
  ): Promise<Challenge> {
    const ch = await this.challenges.findById(challengeId);
    if (
      !ch ||
      ch.channel !== 'PHONE' ||
      ch.targetFingerprint !== principalFingerprint ||
      ch.status === 'VERIFIED' ||
      ch.status === 'SUPERSEDED'
    ) {
      throw new OtpInvalidError();
    }
    return ch;
  }

  private async dispatch(
    challenge: Challenge,
    phone: PhoneNumber,
  ): Promise<Challenge> {
    const otp = await this.otp.create(challenge, this.policy);
    let accepted = false;
    try {
      accepted = (
        await this.sms.send(phone, {
          template: 'OTP',
          vars: {
            otp,
            expiresInMinutes: Math.ceil(this.policy.ttlSeconds / 60),
          },
        })
      ).accepted;
    } catch (err) {
      this.logger.warn('sms.dispatch_error', {
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
          name: 'OTP Dispatch Updated',
          screenId: SCREEN_PHONE,
          outcome: accepted ? 'accepted' : 'failed',
          safeErrorCategory: accepted ? undefined : 'delivery',
        },
        tx,
      );
    });
    return updated;
  }

  private async enforce(
    rule: { scope: string; limit: number; windowSeconds: number },
    fingerprint: string,
  ): Promise<void> {
    const decision = await this.limiter.consume(
      rule.scope,
      fingerprint,
      rule.limit,
      rule.windowSeconds,
    );
    if (!decision.allowed)
      throw new RateLimitedError(decision.retryAfterSeconds);
  }
}

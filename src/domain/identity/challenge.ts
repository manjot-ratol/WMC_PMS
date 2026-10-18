import { createHmac, randomInt } from 'node:crypto';

export type ChallengeChannel = 'PHONE' | 'EMAIL';
export type ChallengePurpose = 'PMS_ONBOARDING' | 'EMAIL_VERIFICATION';
export type ChallengeStatus =
  | 'DISPATCH_PENDING'
  | 'DISPATCHED'
  | 'DISPATCH_FAILED'
  | 'VERIFIED'
  | 'SUPERSEDED'
  | 'EXPIRED';

export interface Challenge {
  readonly id: string;
  readonly channel: ChallengeChannel;
  readonly purpose: ChallengePurpose;
  readonly targetFingerprint: string;
  readonly customerId?: string;
  readonly applicationId?: string;
  readonly status: ChallengeStatus;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly resendAfter: Date;
  readonly maxAttempts: number;
  readonly verifiedAt?: Date;
}

export interface OtpPolicy {
  ttlSeconds: number;
  resendAfterSeconds: number;
  maxAttempts: number;
}

export const DEFAULT_OTP_POLICY: OtpPolicy = {
  ttlSeconds: 300,
  resendAfterSeconds: 30,
  maxAttempts: 5,
};

export function newChallenge(
  input: Pick<
    Challenge,
    | 'id'
    | 'channel'
    | 'purpose'
    | 'targetFingerprint'
    | 'customerId'
    | 'applicationId'
  >,
  policy: OtpPolicy,
  now: Date,
): Challenge {
  return {
    ...input,
    status: 'DISPATCH_PENDING',
    createdAt: now,
    expiresAt: new Date(now.getTime() + policy.ttlSeconds * 1000),
    resendAfter: new Date(now.getTime() + policy.resendAfterSeconds * 1000),
    maxAttempts: policy.maxAttempts,
  };
}

export function isExpired(c: Challenge, now: Date): boolean {
  return now.getTime() >= c.expiresAt.getTime();
}

export function canResend(
  c: Challenge,
  now: Date,
): { allowed: boolean; retryAfterSeconds: number } {
  const wait = Math.ceil((c.resendAfter.getTime() - now.getTime()) / 1000);
  return wait > 0
    ? { allowed: false, retryAfterSeconds: wait }
    : { allowed: true, retryAfterSeconds: 0 };
}

export function withStatus(
  c: Challenge,
  status: ChallengeStatus,
  now?: Date,
): Challenge {
  return {
    ...c,
    status,
    verifiedAt: status === 'VERIFIED' ? now : c.verifiedAt,
  };
}

/** Six-digit, uniformly random, leading zeros preserved. */
export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** Keyed digest bound to the challenge and purpose, so a code can never be replayed elsewhere. */
export function otpDigest(
  key: Buffer,
  challengeId: string,
  purpose: ChallengePurpose,
  otp: string,
): string {
  return createHmac('sha256', key)
    .update(`${challengeId}:${purpose}:${otp}`)
    .digest('hex');
}

export function secondsUntil(date: Date, now: Date): number {
  return Math.max(0, Math.ceil((date.getTime() - now.getTime()) / 1000));
}

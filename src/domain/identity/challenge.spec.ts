import {
  DEFAULT_OTP_POLICY,
  canResend,
  generateOtp,
  isExpired,
  newChallenge,
  otpDigest,
  secondsUntil,
  withStatus,
} from './challenge';

describe('Challenge', () => {
  const now = new Date('2026-10-18T00:00:00Z');
  const ch = newChallenge(
    {
      id: 'ch_1',
      channel: 'PHONE',
      purpose: 'PMS_ONBOARDING',
      targetFingerprint: 'fp',
    },
    DEFAULT_OTP_POLICY,
    now,
  );

  it('derives expiry and resend window from the policy', () => {
    expect(ch.expiresAt.getTime() - now.getTime()).toBe(300_000);
    expect(ch.resendAfter.getTime() - now.getTime()).toBe(30_000);
    expect(ch.status).toBe('DISPATCH_PENDING');
    expect(isExpired(ch, new Date(now.getTime() + 299_000))).toBe(false);
    expect(isExpired(ch, new Date(now.getTime() + 300_000))).toBe(true);
  });
  it('canResend respects the cooldown', () => {
    expect(canResend(ch, new Date(now.getTime() + 10_000))).toEqual({
      allowed: false,
      retryAfterSeconds: 20,
    });
    expect(canResend(ch, new Date(now.getTime() + 30_000))).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });
  it('withStatus records verifiedAt only for VERIFIED', () => {
    expect(withStatus(ch, 'VERIFIED', now).verifiedAt).toBe(now);
    expect(withStatus(ch, 'SUPERSEDED').verifiedAt).toBeUndefined();
  });
  it('generateOtp is six digits with leading zeros kept', () => {
    for (let i = 0; i < 200; i++) expect(generateOtp()).toMatch(/^\d{6}$/);
  });
  it('otpDigest is deterministic and bound to challenge and purpose', () => {
    const key = Buffer.alloc(32, 1);
    expect(otpDigest(key, 'ch_1', 'PMS_ONBOARDING', '123456')).toBe(
      otpDigest(key, 'ch_1', 'PMS_ONBOARDING', '123456'),
    );
    expect(otpDigest(key, 'ch_2', 'PMS_ONBOARDING', '123456')).not.toBe(
      otpDigest(key, 'ch_1', 'PMS_ONBOARDING', '123456'),
    );
    expect(otpDigest(key, 'ch_1', 'EMAIL_VERIFICATION', '123456')).not.toBe(
      otpDigest(key, 'ch_1', 'PMS_ONBOARDING', '123456'),
    );
  });
  it('secondsUntil never goes negative', () => {
    expect(secondsUntil(now, new Date(now.getTime() + 5000))).toBe(0);
    expect(secondsUntil(new Date(now.getTime() + 1500), now)).toBe(2);
  });
});

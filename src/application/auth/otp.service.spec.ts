import { FakeKv } from '../../../test/support/fakes';
import {
  DEFAULT_OTP_POLICY,
  newChallenge,
} from '../../domain/identity/challenge';
import { OtpService } from './otp.service';

describe('OtpService', () => {
  const now = new Date('2026-10-18T10:00:00Z');
  const key = Buffer.alloc(32, 5).toString('base64');
  let kv: FakeKv;
  let svc: OtpService;
  const challenge = newChallenge(
    {
      id: 'ch_1',
      channel: 'PHONE',
      purpose: 'PMS_ONBOARDING',
      targetFingerprint: 'fp',
    },
    DEFAULT_OTP_POLICY,
    now,
  );

  beforeEach(() => {
    kv = new FakeKv();
    kv.now = () => now.getTime();
    svc = new OtpService(kv, { otpHmacKeyBase64: key });
  });

  it('stores only a digest, never the code, under a fingerprint-based key', async () => {
    const otp = await svc.create(challenge, DEFAULT_OTP_POLICY);
    expect(otp).toMatch(/^\d{6}$/);
    const keys = [...kv.data.keys()];
    expect(keys).toEqual(['otp:phone:fp:ch_1', 'otp:phone:fp:ch_1:attempts']);
    expect(JSON.stringify([...kv.data.values()])).not.toContain(otp);
  });

  it('verifies the right code exactly once and rejects wrong codes', async () => {
    const otp = await svc.create(challenge, DEFAULT_OTP_POLICY);
    const wrong = otp === '000000' ? '000001' : '000000';
    expect(await svc.verify(challenge, wrong, now)).toBe('INVALID');
    expect(await svc.verify(challenge, otp, now)).toBe('OK');
    expect(await svc.verify(challenge, otp, now)).toBe('EXPIRED'); // consumed
    expect(kv.data.size).toBe(0);
  });

  it('locks after max attempts and drops the code', async () => {
    const otp = await svc.create(challenge, DEFAULT_OTP_POLICY);
    const wrong = otp === '000000' ? '000001' : '000000';
    for (let i = 0; i < DEFAULT_OTP_POLICY.maxAttempts; i++)
      expect(await svc.verify(challenge, wrong, now)).toBe('INVALID');
    expect(await svc.verify(challenge, otp, now)).toBe('LOCKED');
    expect(await svc.verify(challenge, otp, now)).toBe('EXPIRED');
  });

  it('reports EXPIRED past the challenge expiry even if the key still exists', async () => {
    const otp = await svc.create(challenge, DEFAULT_OTP_POLICY);
    expect(
      await svc.verify(challenge, otp, new Date(now.getTime() + 300_001)),
    ).toBe('EXPIRED');
  });

  it('supersede removes the code and attempts; email challenges use the email prefix', async () => {
    const email = newChallenge(
      {
        id: 'ech_1',
        channel: 'EMAIL',
        purpose: 'EMAIL_VERIFICATION',
        targetFingerprint: 'efp',
      },
      DEFAULT_OTP_POLICY,
      now,
    );
    await svc.create(email, DEFAULT_OTP_POLICY);
    expect([...kv.data.keys()][0]).toBe('otp:email:efp:ech_1');
    await svc.supersede(email);
    expect(kv.data.size).toBe(0);
  });

  it('only one of two concurrent correct verifications succeeds', async () => {
    const otp = await svc.create(challenge, DEFAULT_OTP_POLICY);
    const results = await Promise.all([
      svc.verify(challenge, otp, now),
      svc.verify(challenge, otp, now),
    ]);
    expect(results.sort()).toEqual(['INVALID', 'OK']);
  });
});

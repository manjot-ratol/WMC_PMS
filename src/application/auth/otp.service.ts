import { Inject, Injectable } from '@nestjs/common';
import { KEY_PREFIX, KV_STORE, type KvStorePort } from '../ports/kv-store.port';
import { cryptoConfig } from '../../common/config/crypto.config';
import { constantTimeEquals } from '../../common/crypto/constant-time';
import {
  generateOtp,
  isExpired,
  otpDigest,
  type Challenge,
  type OtpPolicy,
} from '../../domain/identity/challenge';

interface StoredOtp {
  digest: string;
  purpose: Challenge['purpose'];
}

export type OtpVerifyResult = 'OK' | 'INVALID' | 'LOCKED' | 'EXPIRED';

/**
 * OTP mechanics over Redis: keyed digest with TTL, attempt counter, single-use consumption.
 * The plaintext code exists only in memory between generation and dispatch.
 */
@Injectable()
export class OtpService {
  private readonly key: Buffer;

  constructor(
    @Inject(KV_STORE) private readonly kv: KvStorePort,
    @Inject(cryptoConfig.KEY)
    cfg: Pick<ReturnType<typeof cryptoConfig>, 'otpHmacKeyBase64'>,
  ) {
    this.key = Buffer.from(cfg.otpHmacKeyBase64, 'base64');
  }

  /** Generates and stores the code for a challenge; returns the plaintext for dispatch only. */
  async create(challenge: Challenge, policy: OtpPolicy): Promise<string> {
    const otp = generateOtp();
    const stored: StoredOtp = {
      digest: otpDigest(this.key, challenge.id, challenge.purpose, otp),
      purpose: challenge.purpose,
    };
    await this.kv.setJson(this.dataKey(challenge), stored, policy.ttlSeconds);
    await this.kv.setJson(this.attemptsKey(challenge), 0, policy.ttlSeconds);
    return otp;
  }

  async verify(
    challenge: Challenge,
    otp: string,
    now: Date,
  ): Promise<OtpVerifyResult> {
    if (isExpired(challenge, now)) return 'EXPIRED';
    const attempts = await this.kv.incr(this.attemptsKey(challenge));
    if (attempts > challenge.maxAttempts) {
      await this.supersede(challenge);
      return 'LOCKED';
    }
    const stored = await this.kv.getJson<StoredOtp>(this.dataKey(challenge));
    if (!stored) {
      await this.kv.del(this.attemptsKey(challenge));
      return 'EXPIRED';
    }
    const expected = otpDigest(this.key, challenge.id, challenge.purpose, otp);
    if (!constantTimeEquals(expected, stored.digest)) return 'INVALID';
    // Single use: only the first matching caller gets the value; a concurrent duplicate sees null.
    const consumed = await this.kv.getAndDelJson<StoredOtp>(
      this.dataKey(challenge),
    );
    if (!consumed) return 'INVALID';
    await this.kv.del(this.attemptsKey(challenge));
    return 'OK';
  }

  async supersede(challenge: Challenge): Promise<void> {
    await this.kv.del(this.dataKey(challenge));
    await this.kv.del(this.attemptsKey(challenge));
  }

  private dataKey(c: Challenge): string {
    return `${c.channel === 'PHONE' ? KEY_PREFIX.otpPhone : KEY_PREFIX.otpEmail}${c.targetFingerprint}:${c.id}`;
  }
  private attemptsKey(c: Challenge): string {
    return `${this.dataKey(c)}:attempts`;
  }
}

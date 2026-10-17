import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { cryptoConfig } from '../config/crypto.config';

export type FingerprintPurpose = 'phone' | 'email' | 'pan' | 'account' | 'otp';

/** Keyed HMAC-SHA256 fingerprints for lookups and Redis keys, so raw identifiers never appear in either. */
@Injectable()
export class Fingerprint {
  private readonly key: Buffer;

  constructor(
    @Inject(cryptoConfig.KEY)
    cfg: Pick<ReturnType<typeof cryptoConfig>, 'fingerprintKeyBase64'>,
  ) {
    this.key = Buffer.from(cfg.fingerprintKeyBase64, 'base64');
  }

  of(value: string, purpose: FingerprintPurpose): string {
    return createHmac('sha256', this.key)
      .update(`${purpose}:${normalize(value, purpose)}`)
      .digest('hex');
  }
}

export function normalize(value: string, purpose: FingerprintPurpose): string {
  switch (purpose) {
    case 'email':
      return value.trim().toLowerCase();
    case 'pan':
      return value.replace(/\s+/g, '').toUpperCase();
    case 'phone':
    case 'account':
      return value.replace(/\s+/g, '');
    default:
      return value;
  }
}

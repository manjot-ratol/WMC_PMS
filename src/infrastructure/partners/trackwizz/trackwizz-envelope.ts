import {
  constants,
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  createSign,
  createVerify,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
  type KeyObject,
} from 'node:crypto';

/**
 * Every parameter the AS501 document leaves ambiguous (p.80–81: "256-bit session key", "AES 128", RSA 1024/2048,
 * unspecified padding/IV/signature hash). Defaults are the most common vendor-SDK choices; confirm with test vectors.
 */
export interface TrackWizzCryptoProfile {
  sessionKeyBytes: 16 | 24 | 32;
  cipher:
    | 'aes-128-cbc'
    | 'aes-192-cbc'
    | 'aes-256-cbc'
    | 'aes-128-ecb'
    | 'aes-256-ecb';
  /** zero: 16 zero bytes; prefixed: random IV prepended to the ciphertext; none: ECB. */
  iv: 'zero' | 'prefixed' | 'none';
  rsaPadding: 'pkcs1' | 'oaep-sha1' | 'oaep-sha256';
  signatureAlgorithm: 'RSA-SHA256' | 'RSA-SHA1' | 'RSA-SHA512';
  /** What is signed: the two base64 strings concatenated in this order. */
  signInput: 'data+key' | 'key+data';
}
export const DEFAULT_CRYPTO_PROFILE: TrackWizzCryptoProfile = {
  sessionKeyBytes: 32,
  cipher: 'aes-256-cbc',
  iv: 'zero',
  rsaPadding: 'pkcs1',
  signatureAlgorithm: 'RSA-SHA256',
  signInput: 'data+key',
};

export function parseCryptoProfile(
  json: string | undefined,
): TrackWizzCryptoProfile {
  if (!json?.trim()) return DEFAULT_CRYPTO_PROFILE;
  const p = JSON.parse(json) as Partial<TrackWizzCryptoProfile>;
  const merged = { ...DEFAULT_CRYPTO_PROFILE, ...p };
  if (![16, 24, 32].includes(merged.sessionKeyBytes))
    throw new Error(
      'TRACKWIZZ_CRYPTO_PROFILE.sessionKeyBytes must be 16, 24 or 32',
    );
  if (merged.cipher.endsWith('ecb') !== (merged.iv === 'none'))
    throw new Error(
      'TRACKWIZZ_CRYPTO_PROFILE: ECB ciphers need iv "none" and CBC ciphers an IV mode',
    );
  return merged;
}

export interface Envelope {
  EncryptedData: string;
  EncryptionKey: string;
  Signature: string;
}
export class EnvelopeError extends Error {
  constructor(
    readonly category:
      | 'signature_invalid'
      | 'key_unwrap_failed'
      | 'decrypt_failed'
      | 'malformed_envelope'
      | 'invalid_json',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'EnvelopeError';
  }
}

/** Seals requests for the receiver and opens responses from the sender. Keys are KeyObjects; PEM never leaves config. */
export class TrackWizzEnvelope {
  private readonly ownPrivate: KeyObject;
  private readonly peerPublic: KeyObject;

  constructor(
    ownPrivateKeyPem: string,
    peerPublicKeyPem: string,
    private readonly profile: TrackWizzCryptoProfile = DEFAULT_CRYPTO_PROFILE,
  ) {
    this.ownPrivate = createPrivateKey(ownPrivateKeyPem);
    this.peerPublic = createPublicKey(peerPublicKeyPem);
  }

  /** Doc §6.1: session key → AES → base64; RSA(peer public) → base64; sign(data+key) with own private key. */
  seal(payload: unknown): Envelope {
    const key = randomBytes(this.profile.sessionKeyBytes);
    const EncryptedData = this.aesEncrypt(
      Buffer.from(JSON.stringify(payload), 'utf8'),
      key,
    ).toString('base64');
    const EncryptionKey = publicEncrypt(
      { key: this.peerPublic, ...this.rsaOptions() },
      key,
    ).toString('base64');
    const Signature = createSign(this.profile.signatureAlgorithm)
      .update(this.signInput(EncryptedData, EncryptionKey))
      .sign(this.ownPrivate)
      .toString('base64');
    return { EncryptedData, EncryptionKey, Signature };
  }

  /** Doc §6.2: verify the signature first with the peer public key, then unwrap the key, then decrypt. */
  open<T = unknown>(envelope: Partial<Envelope> | null | undefined): T {
    if (
      !envelope ||
      typeof envelope.EncryptedData !== 'string' ||
      typeof envelope.EncryptionKey !== 'string' ||
      typeof envelope.Signature !== 'string'
    )
      throw new EnvelopeError('malformed_envelope', 'Envelope fields missing');
    const verified = (() => {
      try {
        return createVerify(this.profile.signatureAlgorithm)
          .update(
            this.signInput(envelope.EncryptedData, envelope.EncryptionKey),
          )
          .verify(this.peerPublic, Buffer.from(envelope.Signature, 'base64'));
      } catch {
        return false;
      }
    })();
    if (!verified)
      throw new EnvelopeError(
        'signature_invalid',
        'Response signature did not verify',
      );
    let key: Buffer;
    try {
      key = privateDecrypt(
        { key: this.ownPrivate, ...this.rsaOptions() },
        Buffer.from(envelope.EncryptionKey, 'base64'),
      );
    } catch (cause) {
      throw new EnvelopeError(
        'key_unwrap_failed',
        'Session key could not be unwrapped',
        { cause },
      );
    }
    let plain: Buffer;
    try {
      plain = this.aesDecrypt(
        Buffer.from(envelope.EncryptedData, 'base64'),
        key,
      );
    } catch (cause) {
      throw new EnvelopeError(
        'decrypt_failed',
        'Payload could not be decrypted',
        { cause },
      );
    }
    try {
      return JSON.parse(plain.toString('utf8')) as T;
    } catch (cause) {
      throw new EnvelopeError('invalid_json', 'Decrypted payload is not JSON', {
        cause,
      });
    }
  }

  private signInput(data: string, key: string): string {
    return this.profile.signInput === 'data+key' ? data + key : key + data;
  }
  private rsaOptions(): { padding: number; oaepHash?: string } {
    switch (this.profile.rsaPadding) {
      case 'oaep-sha1':
        return { padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' };
      case 'oaep-sha256':
        return {
          padding: constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
        };
      default:
        return { padding: constants.RSA_PKCS1_PADDING };
    }
  }
  private aesEncrypt(plain: Buffer, key: Buffer): Buffer {
    const iv =
      this.profile.iv === 'none'
        ? null
        : this.profile.iv === 'zero'
          ? Buffer.alloc(16, 0)
          : randomBytes(16);
    const c = createCipheriv(this.profile.cipher, key, iv);
    const body = Buffer.concat([c.update(plain), c.final()]);
    return this.profile.iv === 'prefixed' ? Buffer.concat([iv!, body]) : body;
  }
  private aesDecrypt(data: Buffer, key: Buffer): Buffer {
    let iv: Buffer | null = null;
    let body = data;
    if (this.profile.iv === 'zero') iv = Buffer.alloc(16, 0);
    else if (this.profile.iv === 'prefixed') {
      iv = data.subarray(0, 16);
      body = data.subarray(16);
    }
    const d = createDecipheriv(this.profile.cipher, key, iv);
    return Buffer.concat([d.update(body), d.final()]);
  }
}

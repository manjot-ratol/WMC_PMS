import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createSign,
  randomBytes,
  type JsonWebKey,
} from 'node:crypto';
import type { MfCentralCryptoPort } from '../../../application/ports/mfcentral-gateway.port';

export const MFCENTRAL_LOCAL_CRYPTO_STATUS =
  'UNVERIFIED_PENDING_MFCENTRAL_CONFIRMATION';
const b64url = (b: Buffer) => b.toString('base64url');

/**
 * Local implementation of the MF Central envelope. The JWS part follows what the collection shows
 * (RS256, `b64:false` detached payload, `kid` from the private JWK). The symmetric part is a placeholder
 * (AES-256-GCM over SHA-256 of the shared key, IV||ciphertext||tag, base64url) because the collection only
 * exposes MF Central's own encrypt/decrypt helpers. Status: UNVERIFIED_PENDING_MFCENTRAL_CONFIRMATION.
 */
export class MfCentralLocalCrypto implements MfCentralCryptoPort {
  private readonly key: Buffer;
  private readonly jwk: JsonWebKey & { kid?: string };
  constructor(sharedKey: string, privateJwkJson: string) {
    this.key = createHash('sha256').update(sharedKey, 'utf8').digest();
    const parsed = JSON.parse(privateJwkJson) as {
      keys?: (JsonWebKey & { kid?: string })[];
    } & JsonWebKey & { kid?: string };
    this.jwk = parsed.keys?.[0] ?? parsed;
  }
  encrypt(plainJson: string): Promise<string> {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([c.update(plainJson, 'utf8'), c.final()]);
    return Promise.resolve(b64url(Buffer.concat([iv, body, c.getAuthTag()])));
  }
  async decrypt(encrypted: string): Promise<string> {
    await Promise.resolve();
    const buf = Buffer.from(encrypted, 'base64url');
    const d = createDecipheriv('aes-256-gcm', this.key, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(buf.length - 16));
    return Promise.resolve(
      Buffer.concat([
        d.update(buf.subarray(12, buf.length - 16)),
        d.final(),
      ]).toString('utf8'),
    );
  }
  /** RFC 7797 detached JWS: header..signature, signing input = base64url(header) + '.' + raw payload. */
  sign(encrypted: string): Promise<string> {
    const header = b64url(
      Buffer.from(
        JSON.stringify({
          alg: 'RS256',
          kid: this.jwk.kid,
          b64: false,
          crit: ['b64'],
        }),
      ),
    );
    const signature = createSign('RSA-SHA256')
      .update(`${header}.${encrypted}`)
      .sign(createPrivateKey({ key: this.jwk as JsonWebKey, format: 'jwk' }));
    return Promise.resolve(`${header}..${b64url(signature)}`);
  }
}

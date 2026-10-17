import { Inject, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { cryptoConfig } from '../config/crypto.config';

export interface EncryptedField {
  keyId: string;
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** AES-256-GCM field-level encryption with a key id prefix so keys can be rotated. */
@Injectable()
export class FieldCipher {
  private readonly keys = new Map<string, Buffer>();
  private readonly activeKeyId: string;

  constructor(
    @Inject(cryptoConfig.KEY)
    cfg: Pick<ReturnType<typeof cryptoConfig>, 'fieldKeyId' | 'fieldKeyBase64'>,
  ) {
    const key = Buffer.from(cfg.fieldKeyBase64, 'base64');
    if (key.length !== 32)
      throw new Error('FIELD_ENCRYPTION_KEY must decode to 32 bytes');
    this.keys.set(cfg.fieldKeyId, key);
    this.activeKeyId = cfg.fieldKeyId;
  }

  encrypt(plaintext: string): EncryptedField {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(
      'aes-256-gcm',
      this.keys.get(this.activeKeyId)!,
      iv,
    );
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return {
      keyId: this.activeKeyId,
      iv,
      tag: cipher.getAuthTag(),
      ciphertext,
    };
  }

  decrypt(field: EncryptedField): string {
    const key = this.keys.get(field.keyId);
    if (!key) throw new Error(`Unknown encryption key id "${field.keyId}"`);
    const decipher = createDecipheriv('aes-256-gcm', key, field.iv);
    decipher.setAuthTag(field.tag);
    return Buffer.concat([
      decipher.update(field.ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }

  encryptToBuffer(plaintext: string): Buffer {
    return FieldCipher.serialize(this.encrypt(plaintext));
  }

  decryptFromBuffer(blob: Buffer): string {
    return this.decrypt(FieldCipher.deserialize(blob));
  }

  /** Layout: [keyIdLen:1][keyId][iv:12][tag:16][ciphertext]. */
  static serialize(f: EncryptedField): Buffer {
    const keyId = Buffer.from(f.keyId, 'utf8');
    return Buffer.concat([
      Buffer.from([keyId.length]),
      keyId,
      f.iv,
      f.tag,
      f.ciphertext,
    ]);
  }

  static deserialize(blob: Buffer): EncryptedField {
    const keyIdLen = blob[0];
    let offset = 1;
    const keyId = blob.subarray(offset, offset + keyIdLen).toString('utf8');
    offset += keyIdLen;
    const iv = blob.subarray(offset, offset + IV_BYTES);
    offset += IV_BYTES;
    const tag = blob.subarray(offset, offset + TAG_BYTES);
    offset += TAG_BYTES;
    return { keyId, iv, tag, ciphertext: blob.subarray(offset) };
  }
}

import { FieldCipher } from './field-cipher';

const key = Buffer.alloc(32, 7).toString('base64');

describe('FieldCipher', () => {
  const cipher = new FieldCipher({ fieldKeyId: 'k1', fieldKeyBase64: key });

  it('round-trips unicode plaintext', () => {
    const f = cipher.encrypt('नमस्ते ABCDE1234F');
    expect(cipher.decrypt(f)).toBe('नमस्ते ABCDE1234F');
    expect(f.keyId).toBe('k1');
    expect(f.iv).toHaveLength(12);
    expect(f.tag).toHaveLength(16);
  });

  it('uses a fresh IV per call', () => {
    const a = cipher.encrypt('same');
    const b = cipher.encrypt('same');
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it('rejects a tampered tag or ciphertext', () => {
    const f = cipher.encrypt('x');
    const tampered = { ...f, tag: Buffer.from(f.tag.map((b) => b ^ 1)) };
    expect(() => cipher.decrypt(tampered)).toThrow();
  });

  it('rejects an unknown key id', () => {
    const f = { ...cipher.encrypt('x'), keyId: 'k9' };
    expect(() => cipher.decrypt(f)).toThrow(/key id/i);
  });

  it('serializes to a single buffer and back', () => {
    const f = cipher.encrypt('serialize me');
    const blob = FieldCipher.serialize(f);
    expect(blob[0]).toBe(2); // keyId length
    const back = FieldCipher.deserialize(blob);
    expect(cipher.decrypt(back)).toBe('serialize me');
  });

  it('encryptToBuffer / decryptFromBuffer convenience', () => {
    const blob = cipher.encryptToBuffer('hello');
    expect(cipher.decryptFromBuffer(blob)).toBe('hello');
  });

  it('rejects a key of the wrong length', () => {
    expect(
      () =>
        new FieldCipher({
          fieldKeyId: 'k',
          fieldKeyBase64: Buffer.alloc(16).toString('base64'),
        }),
    ).toThrow(/32 bytes/);
  });
});

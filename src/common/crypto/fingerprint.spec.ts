import { Fingerprint } from './fingerprint';

describe('Fingerprint', () => {
  const fp = new Fingerprint({
    fingerprintKeyBase64: Buffer.alloc(32, 9).toString('base64'),
  });

  it('is deterministic and hex encoded', () => {
    const a = fp.of('+919000000001', 'phone');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(fp.of('+919000000001', 'phone')).toBe(a);
  });

  it('separates purposes', () => {
    expect(fp.of('X', 'phone')).not.toBe(fp.of('X', 'email'));
  });

  it('normalizes case and whitespace for email and pan, and trims phone', () => {
    expect(fp.of(' Abc@Example.COM ', 'email')).toBe(
      fp.of('abc@example.com', 'email'),
    );
    expect(fp.of('abcde1234f', 'pan')).toBe(fp.of('ABCDE1234F', 'pan'));
    expect(fp.of(' +91 90000 00001 ', 'phone')).toBe(
      fp.of('+919000000001', 'phone'),
    );
  });

  it('leaves otp values untouched by normalisation', () => {
    expect(fp.of(' 123456 ', 'otp')).not.toBe(fp.of('123456', 'otp'));
  });

  it('differs with a different key', () => {
    const other = new Fingerprint({
      fingerprintKeyBase64: Buffer.alloc(32, 1).toString('base64'),
    });
    expect(other.of('X', 'pan')).not.toBe(fp.of('X', 'pan'));
  });
});

import { REDACTED, REDACTED_KEYS, redact } from './redaction';

describe('redact', () => {
  it('redacts sensitive keys at any depth, case-insensitively', () => {
    const out = redact({
      pan_no: 'ABCDE1234F',
      nested: { Authorization: 'Basic x', keep: 1, deeper: { otp: '123456' } },
    }) as Record<string, unknown>;
    expect(out.pan_no).toBe(REDACTED);
    expect((out.nested as Record<string, unknown>).Authorization).toBe(
      REDACTED,
    );
    expect((out.nested as Record<string, unknown>).keep).toBe(1);
    expect(
      (
        (out.nested as Record<string, unknown>).deeper as Record<
          string,
          unknown
        >
      ).otp,
    ).toBe(REDACTED);
  });

  it('redacts inside arrays', () => {
    const out = redact([{ account_number: '1' }, 'plain']) as unknown[];
    expect((out[0] as Record<string, unknown>).account_number).toBe(REDACTED);
    expect(out[1]).toBe('plain');
  });

  it('redacts Error.cause fields and keeps name and stack', () => {
    const err = new Error('boom', { cause: { client_secret: 's3', why: 'x' } });
    const out = redact(err) as Record<string, unknown>;
    expect(out.name).toBe('Error');
    expect(out.message).toBe('boom');
    expect(typeof out.stack).toBe('string');
    expect((out.cause as Record<string, unknown>).client_secret).toBe(REDACTED);
    expect((out.cause as Record<string, unknown>).why).toBe('x');
  });

  it('masks key=value fragments for sensitive keys inside strings', () => {
    expect(redact('request failed token=abc123 code=1')).toBe(
      `request failed token=${REDACTED} code=1`,
    );
  });

  it('survives circular references', () => {
    const a: Record<string, unknown> = { pan: 'X' };
    a.self = a;
    const out = redact(a) as Record<string, unknown>;
    expect(out.pan).toBe(REDACTED);
    expect(out.self).toBe('[Circular]');
  });

  it('leaves primitives, dates and buffers alone', () => {
    const d = new Date(0);
    expect(redact(42)).toBe(42);
    expect(redact(d)).toBe(d);
    expect(Buffer.isBuffer(redact(Buffer.from('x')))).toBe(true);
  });

  it('covers the agreed key list', () => {
    for (const k of [
      'otp',
      'pan',
      'pan_no',
      'aadhaar',
      'uid_no',
      'account_number',
      'tin',
      'password',
      'authorization',
      'access_token',
      'token',
      'secret',
      'client_secret',
    ]) {
      expect(REDACTED_KEYS.has(k)).toBe(true);
    }
  });
});

import { normaliseEmail } from '../shared/email-address';
import { normalisePhone } from '../shared/phone-number';
import {
  newProvisionalCustomer,
  proposeEmail,
  verifyEmail,
  verifyPhone,
} from './customer';

describe('Customer', () => {
  const now = new Date('2026-10-18T00:00:00Z');
  const c = newProvisionalCustomer('cus_1', normalisePhone('9000000001'), now);

  it('starts unverified at version 0', () => {
    expect(c).toMatchObject({ state: 'UNVERIFIED', version: 0 });
  });
  it('verifyPhone is idempotent and bumps the version once', () => {
    const v = verifyPhone(c, now);
    expect(v).toMatchObject({
      state: 'VERIFIED',
      phoneVerifiedAt: now,
      version: 1,
    });
    expect(verifyPhone(v, new Date())).toBe(v);
  });
  it('proposeEmail clears verification; verifyEmail requires the proposed email', () => {
    const email = normaliseEmail('a@example.com');
    const p = proposeEmail(verifyPhone(c, now), email);
    expect(p).toMatchObject({ email, emailVerifiedAt: undefined, version: 2 });
    expect(() =>
      verifyEmail(p, normaliseEmail('other@example.com'), now),
    ).toThrow();
    const v = verifyEmail(p, email, now);
    expect(v.emailVerifiedAt).toBe(now);
    expect(verifyEmail(v, email, now)).toBe(v);
    expect(proposeEmail(v, email)).toBe(v);
  });
});

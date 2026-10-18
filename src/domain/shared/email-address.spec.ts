import { ValidationError } from '../../common/errors/app-error';
import { maskEmail, normaliseEmail } from './email-address';

describe('email address', () => {
  it('trims and lower-cases the domain, keeping the local part', () => {
    expect(normaliseEmail('  Customer.Name@Example.COM ')).toBe(
      'Customer.Name@example.com',
    );
  });
  it.each([
    'nope',
    'a@b',
    '@example.com',
    'a b@example.com',
    'x@-.com',
    7,
    '',
    `${'a'.repeat(70)}@example.com`,
  ])('rejects %s', (raw) => {
    expect(() => normaliseEmail(raw)).toThrow(ValidationError);
  });
  it('masks the local part to its first character', () => {
    expect(maskEmail(normaliseEmail('customer@example.com'))).toBe(
      'c***@example.com',
    );
  });
});

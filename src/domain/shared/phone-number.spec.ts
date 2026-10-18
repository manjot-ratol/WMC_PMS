import { ValidationError } from '../../common/errors/app-error';
import { maskPhone, normalisePhone } from './phone-number';

describe('phone number', () => {
  it.each([
    ['9000000001', '+919000000001'],
    ['09000000001', '+919000000001'],
    ['+91 90000 00001', '+919000000001'],
    ['91-9000000001', '+919000000001'],
    ['00919000000001', '+919000000001'],
    ['(+91) 90000-00001', '+919000000001'],
  ])('normalises %s', (raw, expected) =>
    expect(normalisePhone(raw)).toBe(expected),
  );

  it.each(['12345', '5000000001', '+447700900000', 'abc', '', 42, null])(
    'rejects %s',
    (raw) => {
      expect(() => normalisePhone(raw)).toThrow(ValidationError);
    },
  );

  it('masks all but the last four digits', () => {
    expect(maskPhone(normalisePhone('9000000001'))).toBe('+91 ******0001');
  });
});

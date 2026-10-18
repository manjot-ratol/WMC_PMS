import { ValidationError } from '../../common/errors/app-error';

/** E.164 Indian mobile number, e.g. +919000000001. Only +91 is supported in this phase. */
export type PhoneNumber = string & { readonly __brand: 'PhoneNumber' };

const INDIAN_MOBILE = /^[6-9]\d{9}$/;

export function normalisePhone(raw: unknown): PhoneNumber {
  if (typeof raw !== 'string')
    throw new ValidationError('Enter a valid mobile number', {
      details: { field: 'phone' },
    });
  let digits = raw.replace(/[\s\-().]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('0091')) digits = digits.slice(4);
  else if (digits.startsWith('91') && digits.length === 12)
    digits = digits.slice(2);
  else if (digits.startsWith('0') && digits.length === 11)
    digits = digits.slice(1);
  if (!INDIAN_MOBILE.test(digits))
    throw new ValidationError('Enter a valid Indian mobile number', {
      details: { field: 'phone' },
    });
  return `+91${digits}` as PhoneNumber;
}

export function maskPhone(phone: PhoneNumber): string {
  return `${phone.slice(0, 3)} ******${phone.slice(-4)}`;
}

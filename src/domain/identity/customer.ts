import type { EmailAddress } from '../shared/email-address';
import type { PhoneNumber } from '../shared/phone-number';

export type CustomerState = 'UNVERIFIED' | 'VERIFIED';

export interface Customer {
  readonly id: string;
  readonly phone: PhoneNumber;
  readonly phoneVerifiedAt?: Date;
  readonly email?: EmailAddress;
  readonly emailVerifiedAt?: Date;
  readonly state: CustomerState;
  readonly version: number;
  readonly createdAt: Date;
}

export function newProvisionalCustomer(
  id: string,
  phone: PhoneNumber,
  now: Date,
): Customer {
  return { id, phone, state: 'UNVERIFIED', version: 0, createdAt: now };
}

export function verifyPhone(c: Customer, now: Date): Customer {
  if (c.state === 'VERIFIED' && c.phoneVerifiedAt) return c;
  return {
    ...c,
    state: 'VERIFIED',
    phoneVerifiedAt: now,
    version: c.version + 1,
  };
}

/** Records a proposed (unverified) email. A previously verified email stays verified until the new one is proven. */
export function proposeEmail(c: Customer, email: EmailAddress): Customer {
  if (c.email === email && c.emailVerifiedAt) return c;
  return { ...c, email, emailVerifiedAt: undefined, version: c.version + 1 };
}

export function verifyEmail(
  c: Customer,
  email: EmailAddress,
  now: Date,
): Customer {
  if (c.email !== email)
    throw new Error('Cannot verify an email that is not the proposed email');
  if (c.emailVerifiedAt) return c;
  return { ...c, emailVerifiedAt: now, version: c.version + 1 };
}

import { ValidationError } from '../../common/errors/app-error';
import type { IsoDate } from '../shared/iso-date';

export type IdentityStatus = 'SUBMITTED' | 'DUPLICATE_REVIEW';

export interface IdentityVersion {
  readonly applicationId: string;
  readonly version: number;
  readonly pan: string;
  readonly legalName: string;
  readonly dateOfBirth: IsoDate;
  readonly permissionVersion: string;
  readonly status: IdentityStatus;
  readonly submittedAt: Date;
}

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export function normalisePan(raw: unknown): string {
  const pan =
    typeof raw === 'string' ? raw.replace(/\s+/g, '').toUpperCase() : '';
  if (!PAN_RE.test(pan))
    throw new ValidationError('PAN must be in the format ABCDE1234F', {
      details: { field: 'pan' },
    });
  return pan;
}

export function normaliseLegalName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (
    name.length < 2 ||
    name.length > 100 ||
    !/^[A-Za-z][A-Za-z .'-]*$/.test(name)
  ) {
    throw new ValidationError('Enter the legal name as per official records', {
      details: { field: 'legal_name' },
    });
  }
  return name;
}

/** Fourth PAN character identifies the holder type; 'P' is an individual. */
export function panHolderType(pan: string): 'INDIVIDUAL' | 'OTHER' {
  return pan[3] === 'P' ? 'INDIVIDUAL' : 'OTHER';
}

export function isAdult(dob: IsoDate, now: Date): boolean {
  const [y, m, d] = dob.split('-').map(Number);
  const eighteenth = new Date(Date.UTC(y + 18, m - 1, d));
  return eighteenth.getTime() <= now.getTime();
}

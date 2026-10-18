import { createHash } from 'node:crypto';

/** What the customer confirmed on screen 20: section versions plus masked summaries, never raw identifiers. */
export interface ReviewSections {
  identity: {
    version: number;
    legalName: string;
    panMasked: string;
    dateOfBirth: string;
  };
  kyc: { version: number; status: string; route?: string };
  profile: {
    version: number;
    occupation: string;
    annualIncomeBand: string;
    sourceOfFunds: string[];
  };
  declarations: {
    version: number;
    taxResidencyCountries: string[];
    pepDeclaration: string;
    declarationVersion: string;
  };
  bank: {
    verificationId: string;
    accountMasked: string;
    ifsc: string;
    holderName: string;
  };
  nomination: { version: number; choice: string; nomineeCount: number };
  suitability: {
    assessmentId: string;
    version: number;
    riskProfile?: string;
    questionnaireVersion: string;
  };
  approach: {
    version: number;
    approachCode: string;
    assessmentVersion: number;
  };
  acknowledgements: {
    version: number;
    documentPackVersion: number;
    documents: { documentType: string; documentVersion: string }[];
  };
  eligibility: {
    version: number;
    intendedInvestmentInr: number;
    journeyRoute?: string;
  };
}
export type SnapshotStatus = 'CURRENT' | 'SUPERSEDED';
export interface ReviewSnapshot {
  readonly id: string;
  readonly applicationId: string;
  /** Application version the customer confirmed (before the confirmation itself bumped it). */
  readonly confirmedApplicationVersion: number;
  /** Application version right after confirmation; a later edit makes the snapshot stale. */
  readonly applicationVersion: number;
  readonly documentPackVersion: number;
  readonly sections: ReviewSections;
  readonly hash: string;
  readonly status: SnapshotStatus;
  readonly confirmedAt: Date;
}

export const maskPan = (pan: string): string =>
  `${pan.slice(0, 2)}••••••${pan.slice(-2)}`;

/** Deterministic key order so the same content always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashSections(sections: ReviewSections): string {
  return createHash('sha256').update(canonicalJson(sections)).digest('hex');
}

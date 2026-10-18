import { ValidationError } from '../../common/errors/app-error';
import { isIsoDate, type IsoDate } from '../shared/iso-date';
import { loadRulebook } from '../shared/rulebook-loader';

export interface NominationRulebook {
  version: string;
  maxNominees: number;
  relationships: string[];
}
export const NOMINATION_RULEBOOK = Symbol('NOMINATION_RULEBOOK');
export const loadNominationRulebook = (file?: string): NominationRulebook =>
  loadRulebook<NominationRulebook>(
    'nomination.v1.json',
    ['version', 'maxNominees', 'relationships'],
    file,
  );

export interface NomineeInput {
  fullName: string;
  relationship: string;
  isMinor: boolean;
  dateOfBirth?: string;
  allocationPercent?: number;
  guardian?: { fullName: string; relationship: string };
}
export interface NominationInput {
  choice: 'NOMINATE' | 'OPT_OUT';
  allocationMode?: 'EQUAL' | 'CUSTOM';
  nominees: NomineeInput[];
}
export interface Nomination extends NominationInput {
  readonly applicationId: string;
  readonly version: number;
  readonly registrationStatus:
    'NOT_SUBMITTED' | 'SUBMITTED' | 'REGISTERED' | 'REJECTED';
  readonly savedAt: Date;
}

const NAME_RE = /^[A-Za-z][A-Za-z .'-]{1,99}$/;

/** Validates the instruction and returns the nominees with allocations resolved (equal split when EQUAL). */
export function validateNomination(
  input: NominationInput,
  rulebook: NominationRulebook,
): NomineeInput[] {
  if (input.choice !== 'NOMINATE' && input.choice !== 'OPT_OUT')
    throw new ValidationError(undefined, {
      details: { field: 'choice', allowed: ['NOMINATE', 'OPT_OUT'] },
    });
  if (input.choice === 'OPT_OUT') {
    if (input.nominees?.length)
      throw new ValidationError(undefined, {
        details: { field: 'nominees', reason: 'not_allowed_with_opt_out' },
      });
    return [];
  }
  const nominees = input.nominees ?? [];
  if (!nominees.length || nominees.length > rulebook.maxNominees)
    throw new ValidationError(undefined, {
      details: { field: 'nominees', min: 1, max: rulebook.maxNominees },
    });
  const mode = input.allocationMode ?? 'EQUAL';
  if (mode !== 'EQUAL' && mode !== 'CUSTOM')
    throw new ValidationError(undefined, {
      details: { field: 'allocation_mode', allowed: ['EQUAL', 'CUSTOM'] },
    });
  const resolved = nominees.map((n, i) => {
    if (!NAME_RE.test((n.fullName ?? '').trim()))
      throw new ValidationError(undefined, {
        details: { field: `nominees[${i}].full_name` },
      });
    if (!rulebook.relationships.includes(n.relationship))
      throw new ValidationError(undefined, {
        details: {
          field: `nominees[${i}].relationship`,
          allowed: rulebook.relationships,
        },
      });
    if (n.isMinor) {
      if (!n.dateOfBirth || !isIsoDate(n.dateOfBirth))
        throw new ValidationError(undefined, {
          details: {
            field: `nominees[${i}].date_of_birth`,
            reason: 'required_for_minor',
          },
        });
      if (
        !n.guardian?.fullName ||
        !NAME_RE.test(n.guardian.fullName.trim()) ||
        !rulebook.relationships.includes(n.guardian.relationship)
      )
        throw new ValidationError(undefined, {
          details: {
            field: `nominees[${i}].guardian`,
            reason: 'required_for_minor',
          },
        });
    }
    if (
      mode === 'CUSTOM' &&
      (!Number.isInteger(n.allocationPercent) ||
        (n.allocationPercent as number) <= 0)
    )
      throw new ValidationError(undefined, {
        details: {
          field: `nominees[${i}].allocation_percent`,
          reason: 'positive_integer',
        },
      });
    return {
      ...n,
      fullName: n.fullName.trim(),
      dateOfBirth: n.dateOfBirth as IsoDate | undefined,
    };
  });
  if (mode === 'CUSTOM') {
    const total = resolved.reduce((s, n) => s + (n.allocationPercent ?? 0), 0);
    if (total !== 100)
      throw new ValidationError(undefined, {
        details: {
          field: 'nominees.allocation_percent',
          reason: 'must_sum_to_100',
          total,
        },
      });
    return resolved;
  }
  const base = Math.floor(100 / resolved.length);
  return resolved.map((n, i) => ({
    ...n,
    allocationPercent: i === 0 ? 100 - base * (resolved.length - 1) : base,
  }));
}

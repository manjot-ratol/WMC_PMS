import { ValidationError } from '../../common/errors/app-error';
import { loadRulebook } from '../shared/rulebook-loader';

export interface ProfileRulebook {
  version: string;
  occupations: string[];
  annualIncomeBands: string[];
  sourcesOfFunds: string[];
  explanationRequiredFor: string[];
  evidenceRequiredWhen: { incomeBands: string[]; sources: string[] };
}
export const PROFILE_RULEBOOK = Symbol('PROFILE_RULEBOOK');
export const loadProfileRulebook = (file?: string): ProfileRulebook =>
  loadRulebook<ProfileRulebook>(
    'profile.v1.json',
    ['version', 'occupations', 'annualIncomeBands', 'sourcesOfFunds'],
    file,
  );

export interface ProfileInput {
  occupation: string;
  annualIncomeBand: string;
  sourceOfFunds: string[];
  sourceOfFundsExplanation?: string;
}

export interface CustomerProfile extends ProfileInput {
  readonly applicationId: string;
  readonly version: number;
  readonly evidenceRequired: boolean;
  readonly savedAt: Date;
}

/** Validates vocabulary and conditional particulars; returns whether AML evidence is required by policy. */
export function validateProfile(
  input: ProfileInput,
  rulebook: ProfileRulebook,
): { evidenceRequired: boolean } {
  if (!rulebook.occupations.includes(input.occupation))
    throw new ValidationError(undefined, {
      details: { field: 'occupation', allowed: rulebook.occupations },
    });
  if (!rulebook.annualIncomeBands.includes(input.annualIncomeBand))
    throw new ValidationError(undefined, {
      details: {
        field: 'annual_income_band',
        allowed: rulebook.annualIncomeBands,
      },
    });
  if (
    !input.sourceOfFunds.length ||
    input.sourceOfFunds.some((s) => !rulebook.sourcesOfFunds.includes(s))
  )
    throw new ValidationError(undefined, {
      details: { field: 'source_of_funds', allowed: rulebook.sourcesOfFunds },
    });
  if (new Set(input.sourceOfFunds).size !== input.sourceOfFunds.length)
    throw new ValidationError(undefined, {
      details: { field: 'source_of_funds', reason: 'duplicate' },
    });
  const needsExplanation = input.sourceOfFunds.some((s) =>
    rulebook.explanationRequiredFor.includes(s),
  );
  if (needsExplanation && !(input.sourceOfFundsExplanation ?? '').trim())
    throw new ValidationError(undefined, {
      details: { field: 'source_of_funds_explanation', reason: 'required' },
    });
  const evidenceRequired =
    rulebook.evidenceRequiredWhen.incomeBands.includes(
      input.annualIncomeBand,
    ) ||
    input.sourceOfFunds.some((s) =>
      rulebook.evidenceRequiredWhen.sources.includes(s),
    );
  return { evidenceRequired };
}

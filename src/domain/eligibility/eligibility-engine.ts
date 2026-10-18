import { ValidationError } from '../../common/errors/app-error';
import type { Screen } from '../onboarding/screens';
import type { EligibilityRulebook } from './eligibility-rulebook';

export const CUSTOMER_TYPES = ['INDIVIDUAL', 'NON_INDIVIDUAL'] as const;
export const RESIDENTIAL_STATUSES = [
  'RESIDENT',
  'NRI',
  'OCI',
  'FOREIGN',
] as const;
export const DISTRIBUTION_ROUTES = ['DIRECT', 'DISTRIBUTOR'] as const;

export interface EligibilityInput {
  customerType: (typeof CUSTOMER_TYPES)[number];
  residentialStatus: (typeof RESIDENTIAL_STATUSES)[number];
  intendedInvestmentInr: number;
  distributionRoute: (typeof DISTRIBUTION_ROUTES)[number];
}

export type EligibilityStatus =
  'ELIGIBLE' | 'ASSISTED_REQUIRED' | 'NOT_ELIGIBLE';

export interface EligibilityDecision {
  status: EligibilityStatus;
  rulesetVersion: string;
  journeyRoute?: string;
  reasons: string[];
  nextScreen: Screen;
}

/**
 * Pure rules evaluation. NOT_ELIGIBLE (below minimum investment) outranks ASSISTED_REQUIRED, which outranks
 * ELIGIBLE. Unknown vocabulary is a validation error, never silently eligible.
 */
export function evaluateEligibility(
  input: EligibilityInput,
  rulebook: EligibilityRulebook,
): EligibilityDecision {
  const reasons: string[] = [];
  const lookup = (
    table: Record<string, string>,
    value: string,
    field: string,
  ): string => {
    const outcome = table[value];
    if (!outcome)
      throw new ValidationError(undefined, {
        details: { field, allowed: Object.keys(table) },
      });
    if (outcome === 'ASSISTED_REQUIRED') reasons.push(`${field}:${value}`);
    return outcome;
  };
  if (
    !Number.isInteger(input.intendedInvestmentInr) ||
    input.intendedInvestmentInr <= 0
  ) {
    throw new ValidationError(undefined, {
      details: { field: 'intended_investment_inr' },
    });
  }
  lookup(rulebook.customerTypes, input.customerType, 'customer_type');
  lookup(
    rulebook.residentialStatuses,
    input.residentialStatus,
    'residential_status',
  );
  lookup(
    rulebook.distributionRoutes,
    input.distributionRoute,
    'distribution_route',
  );

  if (input.intendedInvestmentInr < rulebook.minInvestmentInr) {
    return {
      status: 'NOT_ELIGIBLE',
      rulesetVersion: rulebook.version,
      reasons: [...reasons, 'intended_investment_inr:below_minimum'],
      nextScreen: 'NOT_ELIGIBLE',
    };
  }
  if (reasons.length) {
    return {
      status: 'ASSISTED_REQUIRED',
      rulesetVersion: rulebook.version,
      reasons,
      nextScreen: 'ASSISTED_ONBOARDING',
    };
  }
  return {
    status: 'ELIGIBLE',
    rulesetVersion: rulebook.version,
    journeyRoute: rulebook.journeyRoute,
    reasons: [],
    nextScreen: 'PAN_IDENTITY',
  };
}

import * as fs from 'node:fs';
import * as path from 'node:path';

export type RuleOutcome = 'ELIGIBLE' | 'ASSISTED_REQUIRED';

export interface EligibilityRulebook {
  version: string;
  effectiveFrom: string;
  minInvestmentInr: number;
  customerTypes: Record<string, RuleOutcome>;
  residentialStatuses: Record<string, RuleOutcome>;
  distributionRoutes: Record<string, RuleOutcome>;
  journeyRoute: string;
}

export const ELIGIBILITY_RULEBOOK = Symbol('ELIGIBILITY_RULEBOOK');

/** Loads config/rulebooks/eligibility.v1.json. Content is versioned configuration, not code. */
export function loadEligibilityRulebook(
  file = path.resolve(
    process.cwd(),
    'config',
    'rulebooks',
    'eligibility.v1.json',
  ),
): EligibilityRulebook {
  const raw = JSON.parse(
    fs.readFileSync(file, 'utf8'),
  ) as Partial<EligibilityRulebook>;
  for (const key of [
    'version',
    'effectiveFrom',
    'minInvestmentInr',
    'customerTypes',
    'residentialStatuses',
    'distributionRoutes',
    'journeyRoute',
  ] as const) {
    if (raw[key] === undefined)
      throw new Error(`Eligibility rulebook missing "${key}" in ${file}`);
  }
  return raw as EligibilityRulebook;
}

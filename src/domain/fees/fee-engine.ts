import { ValidationError } from '../../common/errors/app-error';
import { loadRulebook } from '../shared/rulebook-loader';

export interface FeeTerms {
  managementFeeBps: number;
  performanceFeeBps: number;
  hurdleRateBps: number;
  highWaterMark: boolean;
  operatingExpensesBps: number;
}
export interface FeeRulebook {
  version: string;
  disclaimerVersion: string;
  approaches: Record<string, FeeTerms>;
  scenarios: {
    code: string;
    assumedReturnBps: number;
    investmentInr: number;
  }[];
}
export const FEE_RULEBOOK = Symbol('FEE_RULEBOOK');
export const loadFeeRulebook = (file?: string): FeeRulebook =>
  loadRulebook<FeeRulebook>(
    'fees.v1.json',
    ['version', 'disclaimerVersion', 'approaches', 'scenarios'],
    file,
  );

export type FeeLineCode =
  | 'GROSS_RETURN'
  | 'MANAGEMENT_FEE'
  | 'PERFORMANCE_FEE'
  | 'OPERATING_EXPENSES'
  | 'TOTAL_FEES'
  | 'NET_RETURN';
export interface FeeLineItem {
  code: FeeLineCode;
  amountInr: number;
}
export interface FeeIllustration {
  approachCode: string;
  scenarioCode: string;
  feeScheduleVersion: string;
  disclaimerVersion: string;
  assumptions: {
    investmentInr: number;
    assumedReturnBps: number;
    periodYears: 1;
  };
  lineItems: FeeLineItem[];
}

const bps = (amount: number, b: number): number =>
  Math.round((amount * b) / 10_000);

/**
 * One-year illustration under the rulebook's terms. Performance fee applies only to the return above the hurdle
 * (never on a loss); management fee and operating expenses accrue on the opening amount. Integer rupees, half-up.
 */
export function illustrateFees(
  approachCode: string,
  scenarioCode: string,
  rulebook: FeeRulebook,
): FeeIllustration {
  const terms = rulebook.approaches[approachCode];
  if (!terms)
    throw new ValidationError(undefined, {
      details: { field: 'approach_code', reason: 'no_fee_terms' },
    });
  const scenario = rulebook.scenarios.find((s) => s.code === scenarioCode);
  if (!scenario)
    throw new ValidationError(undefined, {
      details: {
        field: 'scenario_code',
        allowed: rulebook.scenarios.map((s) => s.code),
      },
    });
  const principal = scenario.investmentInr;
  const gross = bps(principal, scenario.assumedReturnBps);
  const management = bps(principal, terms.managementFeeBps);
  const expenses = bps(principal, terms.operatingExpensesBps);
  const hurdle = bps(principal, terms.hurdleRateBps);
  const excess = Math.max(0, gross - management - expenses - hurdle);
  const performance = bps(excess, terms.performanceFeeBps);
  const totalFees = management + expenses + performance;
  return {
    approachCode,
    scenarioCode,
    feeScheduleVersion: rulebook.version,
    disclaimerVersion: rulebook.disclaimerVersion,
    assumptions: {
      investmentInr: principal,
      assumedReturnBps: scenario.assumedReturnBps,
      periodYears: 1,
    },
    lineItems: [
      { code: 'GROSS_RETURN', amountInr: gross },
      { code: 'MANAGEMENT_FEE', amountInr: management },
      { code: 'PERFORMANCE_FEE', amountInr: performance },
      { code: 'OPERATING_EXPENSES', amountInr: expenses },
      { code: 'TOTAL_FEES', amountInr: totalFees },
      { code: 'NET_RETURN', amountInr: gross - totalFees },
    ],
  };
}

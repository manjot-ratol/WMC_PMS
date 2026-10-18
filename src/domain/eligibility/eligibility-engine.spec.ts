import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ValidationError } from '../../common/errors/app-error';
import { evaluateEligibility } from './eligibility-engine';
import { loadEligibilityRulebook } from './eligibility-rulebook';

describe('eligibility engine', () => {
  const rulebook = loadEligibilityRulebook();
  const ok = {
    customerType: 'INDIVIDUAL',
    residentialStatus: 'RESIDENT',
    intendedInvestmentInr: 5_000_000,
    distributionRoute: 'DIRECT',
  } as const;

  it('loads the v1 rulebook with the owner-stated minimum', () => {
    expect(rulebook.version).toBe('eligibility_v1');
    expect(rulebook.minInvestmentInr).toBe(2_500_000);
  });
  it('resident individual direct above minimum is ELIGIBLE on the single-holder route', () => {
    expect(evaluateEligibility(ok, rulebook)).toEqual({
      status: 'ELIGIBLE',
      rulesetVersion: 'eligibility_v1',
      journeyRoute: 'RESIDENT_SINGLE_HOLDER',
      reasons: [],
      nextScreen: 'PAN_IDENTITY',
    });
  });
  it.each([
    [{ ...ok, customerType: 'NON_INDIVIDUAL' }, 'customer_type:NON_INDIVIDUAL'],
    [{ ...ok, residentialStatus: 'NRI' }, 'residential_status:NRI'],
    [
      { ...ok, distributionRoute: 'DISTRIBUTOR' },
      'distribution_route:DISTRIBUTOR',
    ],
  ] as const)('routes %o to assisted', (input, reason) => {
    const d = evaluateEligibility(input, rulebook);
    expect(d).toMatchObject({
      status: 'ASSISTED_REQUIRED',
      nextScreen: 'ASSISTED_ONBOARDING',
    });
    expect(d.reasons).toContain(reason);
    expect(d.journeyRoute).toBeUndefined();
  });
  it('below-minimum is NOT_ELIGIBLE and outranks assisted reasons', () => {
    const d = evaluateEligibility(
      { ...ok, residentialStatus: 'NRI', intendedInvestmentInr: 2_499_999 },
      rulebook,
    );
    expect(d.status).toBe('NOT_ELIGIBLE');
    expect(d.reasons).toEqual([
      'residential_status:NRI',
      'intended_investment_inr:below_minimum',
    ]);
    expect(
      evaluateEligibility({ ...ok, intendedInvestmentInr: 2_500_000 }, rulebook)
        .status,
    ).toBe('ELIGIBLE');
  });
  it('rejects unknown vocabulary and non-positive or fractional amounts', () => {
    expect(() =>
      evaluateEligibility({ ...ok, customerType: 'TRUST' as never }, rulebook),
    ).toThrow(ValidationError);
    expect(() =>
      evaluateEligibility({ ...ok, intendedInvestmentInr: 0 }, rulebook),
    ).toThrow(ValidationError);
    expect(() =>
      evaluateEligibility({ ...ok, intendedInvestmentInr: 10.5 }, rulebook),
    ).toThrow(ValidationError);
  });
  it('rulebook loader rejects incomplete files', () => {
    expect(() => loadEligibilityRulebook('/dev/null')).toThrow();
    const tmp = path.join(os.tmpdir(), `elg-${process.pid}.json`);
    fs.writeFileSync(tmp, JSON.stringify({ version: 'x' }));
    expect(() => loadEligibilityRulebook(tmp)).toThrow(
      /missing "effectiveFrom"/,
    );
    fs.unlinkSync(tmp);
  });
});

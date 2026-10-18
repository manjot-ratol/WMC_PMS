import { ValidationError } from '../../common/errors/app-error';
import {
  applyEligibility,
  completeStep,
  hasCompleted,
  newApplication,
  requireStep,
} from './application';

describe('OnboardingApplication', () => {
  const now = new Date('2026-10-18T00:00:00Z');
  const app = newApplication('app_1', 'cus_1', now);

  it('starts with PHONE_VERIFIED complete and EMAIL_ENTRY next', () => {
    expect(app).toMatchObject({
      status: 'IN_PROGRESS',
      journeyVersion: 'pms_v3',
      nextScreen: 'EMAIL_ENTRY',
      version: 0,
    });
    expect(hasCompleted(app, 'PHONE_VERIFIED')).toBe(true);
    expect(hasCompleted(app, 'EMAIL_VERIFIED')).toBe(false);
  });
  it('completeStep adds the step, advances and bumps version; repeating is a no-op', () => {
    const a1 = completeStep(app, 'EMAIL_VERIFIED', 'ELIGIBILITY', now);
    expect(a1).toMatchObject({ nextScreen: 'ELIGIBILITY', version: 1 });
    expect(a1.steps.find((s) => s.stepId === 'EMAIL_VERIFIED')).toMatchObject({
      status: 'COMPLETE',
      version: 1,
      completedAt: now,
    });
    expect(completeStep(a1, 'EMAIL_VERIFIED', 'ELIGIBILITY', new Date())).toBe(
      a1,
    );
    const a2 = completeStep(a1, 'EMAIL_VERIFIED', 'PAN_IDENTITY', now);
    expect(a2.steps.find((s) => s.stepId === 'EMAIL_VERIFIED')?.version).toBe(
      2,
    );
  });
  it('requireStep throws ACTION_REQUIRED with the next screen', () => {
    expect(() => requireStep(app, 'EMAIL_VERIFIED')).toThrow(ValidationError);
    expect(() => requireStep(app, 'PHONE_VERIFIED')).not.toThrow();
  });
  it('applyEligibility sets status and next screen per decision', () => {
    const base = completeStep(app, 'EMAIL_VERIFIED', 'ELIGIBILITY', now);
    expect(
      applyEligibility(
        base,
        {
          status: 'ELIGIBLE',
          rulesetVersion: 'v1',
          reasons: [],
          nextScreen: 'PAN_IDENTITY',
        },
        now,
      ),
    ).toMatchObject({
      status: 'IN_PROGRESS',
      nextScreen: 'PAN_IDENTITY',
      version: 2,
    });
    expect(
      applyEligibility(
        base,
        {
          status: 'ASSISTED_REQUIRED',
          rulesetVersion: 'v1',
          reasons: ['x'],
          nextScreen: 'ASSISTED_ONBOARDING',
        },
        now,
      ),
    ).toMatchObject({ status: 'ASSISTED', nextScreen: 'ASSISTED_ONBOARDING' });
    const ne = applyEligibility(
      base,
      {
        status: 'NOT_ELIGIBLE',
        rulesetVersion: 'v1',
        reasons: ['x'],
        nextScreen: 'NOT_ELIGIBLE',
      },
      now,
    );
    expect(ne.status).toBe('NOT_ELIGIBLE');
    // re-evaluating with the same outcome still records a new version
    expect(
      applyEligibility(
        ne,
        {
          status: 'NOT_ELIGIBLE',
          rulesetVersion: 'v1',
          reasons: ['x'],
          nextScreen: 'NOT_ELIGIBLE',
        },
        now,
      ).version,
    ).toBe(ne.version + 1);
  });
});

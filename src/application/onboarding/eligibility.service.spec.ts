import {
  FakeAnalytics,
  FakeApplications,
  FakeAudit,
  FakeEligibility,
  FakeOutbox,
  FakeUow,
  FixedClock,
  SeqIds,
} from '../../../test/support/fakes';
import { NotFoundError, ValidationError } from '../../common/errors/app-error';
import { loadEligibilityRulebook } from '../../domain/eligibility/eligibility-rulebook';
import {
  completeStep,
  newApplication,
} from '../../domain/onboarding/application';
import { ApplicationQueryService } from './application-query.service';
import { EligibilityService } from './eligibility.service';

function build() {
  const clock = new FixedClock();
  const deps = {
    uow: new FakeUow(),
    applications: new FakeApplications(),
    decisions: new FakeEligibility(),
    audit: new FakeAudit(),
    outbox: new FakeOutbox(),
    analytics: new FakeAnalytics(),
    clock,
    ids: new SeqIds(),
  };
  const service = new EligibilityService(
    deps.uow,
    deps.applications,
    deps.decisions,
    deps.audit,
    deps.outbox,
    deps.analytics,
    deps.clock,
    deps.ids,
    loadEligibilityRulebook(),
  );
  const now = clock.now();
  void deps.applications.create(
    completeStep(
      newApplication('app_1', 'cus_1', now),
      'EMAIL_VERIFIED',
      'ELIGIBILITY',
      now,
    ),
  );
  void deps.applications.create(newApplication('app_fresh', 'cus_1', now));
  return { service, deps };
}
const input = {
  customerType: 'INDIVIDUAL',
  residentialStatus: 'RESIDENT',
  intendedInvestmentInr: 5_000_000,
  distributionRoute: 'DIRECT',
} as const;

describe('EligibilityService', () => {
  it('records a versioned decision, advances the application and emits analytics', async () => {
    const { service, deps } = build();
    const d = await service.evaluate('app_1', 'cus_1', input);
    expect(d).toMatchObject({
      status: 'ELIGIBLE',
      rulesetVersion: 'eligibility_v1',
      journeyRoute: 'RESIDENT_SINGLE_HOLDER',
      nextScreen: 'PAN_IDENTITY',
    });
    expect(deps.applications.rows.get('app_1')).toMatchObject({
      nextScreen: 'PAN_IDENTITY',
      status: 'IN_PROGRESS',
      version: 2,
    });
    expect(deps.decisions.rows[0]).toMatchObject({
      applicationId: 'app_1',
      version: 2,
      status: 'ELIGIBLE',
      input,
    });
    expect(deps.analytics.events[0]).toMatchObject({
      name: 'Eligibility Evaluation Completed',
      screenId: '05',
      outcome: 'eligible',
    });
    expect(JSON.stringify(deps.analytics.events)).not.toContain('5000000');
  });

  it('assisted and not-eligible outcomes change the application status', async () => {
    const { service, deps } = build();
    await service.evaluate('app_1', 'cus_1', {
      ...input,
      residentialStatus: 'NRI',
    });
    expect(deps.applications.rows.get('app_1')).toMatchObject({
      status: 'ASSISTED',
      nextScreen: 'ASSISTED_ONBOARDING',
    });
    await service.evaluate('app_1', 'cus_1', {
      ...input,
      intendedInvestmentInr: 100,
    });
    expect(deps.applications.rows.get('app_1')).toMatchObject({
      status: 'NOT_ELIGIBLE',
      nextScreen: 'NOT_ELIGIBLE',
      version: 3,
    });
    expect(deps.decisions.rows.map((r) => r.version)).toEqual([2, 3]);
  });

  it('requires EMAIL_VERIFIED, ownership, and valid input; writes nothing on failure', async () => {
    const { service, deps } = build();
    await expect(
      service.evaluate('app_fresh', 'cus_1', input),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      service.evaluate('app_1', 'cus_other', input),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      service.evaluate('app_1', 'cus_1', {
        ...input,
        intendedInvestmentInr: -5,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(deps.decisions.rows).toHaveLength(0);
    expect(deps.applications.rows.get('app_1')?.version).toBe(1);
  });
});

describe('ApplicationQueryService', () => {
  it('returns the resume summary for the owner and 404 otherwise', async () => {
    const { deps } = build();
    const q = new ApplicationQueryService(deps.applications);
    const s = await q.get('app_1', 'cus_1');
    expect(s).toMatchObject({
      applicationId: 'app_1',
      status: 'IN_PROGRESS',
      nextScreen: 'ELIGIBILITY',
      version: 1,
      journeyVersion: 'pms_v3',
    });
    expect(s.steps.map((x) => x.stepId).sort()).toEqual([
      'EMAIL_VERIFIED',
      'PHONE_VERIFIED',
    ]);
    await expect(q.get('app_1', 'cus_2')).rejects.toBeInstanceOf(NotFoundError);
    await expect(q.get('nope', 'cus_1')).rejects.toBeInstanceOf(NotFoundError);
  });
});

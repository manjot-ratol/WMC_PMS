import {
  FakeAnalytics,
  FakeApplications,
  FakeAudit,
  FakeBank,
  FakeCompliance,
  FakeOutbox,
  FakeTasks,
  FakeUow,
  FixedClock,
  SeqIds,
} from '../../../test/support/fakes';
import { NotFoundError, ValidationError } from '../../common/errors/app-error';
import {
  completeStep,
  newApplication,
} from '../../domain/onboarding/application';
import { BackOfficeReviewService } from './back-office-review.service';

function build() {
  const clock = new FixedClock();
  const now = clock.now();
  const d = {
    uow: new FakeUow(),
    applications: new FakeApplications(),
    compliance: new FakeCompliance(),
    tasks: new FakeTasks(),
    bank: new FakeBank((a) => a),
    audit: new FakeAudit(),
    outbox: new FakeOutbox(),
    analytics: new FakeAnalytics(),
    clock,
    ids: new SeqIds(),
  };
  let app = newApplication('app_1', 'cus_1', now);
  for (const s of [
    'EMAIL_VERIFIED',
    'ELIGIBILITY',
    'IDENTITY',
    'KYC',
    'IPV',
    'PROFILE',
    'DECLARATIONS',
  ] as const)
    app = completeStep(app, s, 'BANK_DETAILS', now);
  void d.applications.create(app);
  void d.compliance.createScreeningRun({
    id: 'sr_1',
    applicationId: 'app_1',
    identityVersion: 1,
    screeningPolicyVersion: 'v',
    status: 'STOP',
    createdAt: now,
  });
  void d.compliance.createAmlAssessment({
    id: 'aml_1',
    applicationId: 'app_1',
    identityVersion: 1,
    profileVersion: 1,
    declarationVersion: 1,
    policyVersion: 'v',
    status: 'REVIEW',
    riskValue: 'High',
    createdAt: now,
  });
  void d.compliance.createCase({
    id: 'case_1',
    applicationId: 'app_1',
    kind: 'SCREENING_HIT',
    sourceRunId: 'sr_1',
    severity: 'HIGH',
    status: 'OPEN',
    providerCaseId: 'C1',
    summary: { hitsCount: 2 },
    createdAt: now,
  });
  void d.compliance.createCase({
    id: 'case_2',
    applicationId: 'app_1',
    kind: 'AML_HIGH_RISK',
    sourceRunId: 'aml_1',
    severity: 'HIGH',
    status: 'OPEN',
    summary: { riskValue: 'High' },
    createdAt: now,
  });
  void d.tasks.create({
    id: 't_fund',
    applicationId: 'app_1',
    category: 'FUNDING_REVIEW',
    status: 'OPEN',
    createdAt: now,
  });
  void d.tasks.create({
    id: 't_clar',
    applicationId: 'app_1',
    category: 'CLARIFICATION',
    status: 'UNDER_REVIEW',
    createdAt: now,
  });
  void d.bank.createAccount({
    id: 'ba_1',
    applicationId: 'app_1',
    accountNumber: '555512345678',
    ifsc: 'HDFC0001234',
    holderName: 'V',
    version: 1,
    createdAt: now,
  });
  void d.bank.createVerification({
    id: 'bv_1',
    applicationId: 'app_1',
    bankAccountId: 'ba_1',
    status: 'REVIEW_REQUIRED',
    requiredActions: [],
    createdAt: now,
    updatedAt: now,
  });
  void d.tasks.create({
    id: 't_bank',
    applicationId: 'app_1',
    category: 'BANK_NAME_REVIEW',
    status: 'OPEN',
    createdAt: now,
  });
  const svc = new BackOfficeReviewService(
    d.uow,
    d.applications,
    d.compliance,
    d.tasks,
    d.bank,
    d.audit,
    d.outbox,
    d.analytics,
    d.clock,
    d.ids,
  );
  return { d, svc, app: () => d.applications.rows.get('app_1')! };
}
const reason = 'Reviewed source documents; false positive on name only.';

describe('BackOfficeReviewService', () => {
  it('lists cases and tasks with bounded limits and visibility flags', async () => {
    const { svc } = build();
    expect((await svc.listCases(['OPEN'], 500)).map((c) => c.caseId)).toEqual([
      'case_1',
      'case_2',
    ]);
    expect(await svc.listCases(['CLOSED'], 10)).toEqual([]);
    const tasks = await svc.listTasks(['OPEN', 'UNDER_REVIEW'], 0);
    expect(tasks).toHaveLength(1);
    expect(
      (await svc.listTasks(['OPEN', 'UNDER_REVIEW'], 10)).map((t) => [
        t.category,
        t.customerVisible,
      ]),
    ).toEqual([
      ['FUNDING_REVIEW', false],
      ['CLARIFICATION', true],
      ['BANK_NAME_REVIEW', false],
    ]);
  });
  it('PROCEED overrides the source run with a documented decision, closes the case and re-triggers activation; analytics stay generic', async () => {
    const { d, svc } = build();
    const r = await svc.decide({
      caseId: 'case_1',
      reviewerId: 'rev-1',
      decision: 'PROCEED',
      reason,
    });
    expect(r).toMatchObject({ caseId: 'case_1', caseStatus: 'CLOSED' });
    expect((await d.compliance.findScreeningRun('sr_1'))!).toMatchObject({
      status: 'PROCEED',
      safeErrorCategory: `review_proceed:${r.decisionId}`,
    });
    expect((await d.compliance.findCase('case_1'))!).toMatchObject({
      status: 'CLOSED',
      summary: { lastDecision: 'PROCEED' },
    });
    expect(d.compliance.decisions[0]).toMatchObject({
      caseId: 'case_1',
      reviewerId: 'rev-1',
      decision: 'PROCEED',
      reason,
    });
    expect(d.audit.events.at(-1)).toMatchObject({
      actorType: 'REVIEWER',
      actorId: 'rev-1',
      action: 'review.decision',
    });
    expect(d.outbox.events.at(-1)).toMatchObject({
      eventType: 'ComplianceOutcomeRecorded',
      payload: { kind: 'REVIEW', outcome: 'PROCEED' },
    });
    expect(d.analytics.events.at(-1)).toMatchObject({
      name: 'Application Processing Updated',
      outcome: 'review_proceed',
    });
    expect(JSON.stringify(d.analytics.events)).not.toMatch(
      /false positive|C1|case_1/,
    );
    await expect(
      svc.decide({
        caseId: 'case_1',
        reviewerId: 'rev-1',
        decision: 'HOLD',
        reason,
      }),
    ).rejects.toMatchObject({ details: { reason: 'case_closed' } });
  });
  it('HOLD keeps the run untouched; REJECT stops the run and closes the application; reasons are mandatory', async () => {
    const { d, svc } = build();
    await expect(
      svc.decide({
        caseId: 'case_2',
        reviewerId: 'rev-1',
        decision: 'HOLD',
        reason: 'short',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(
      await svc.decide({
        caseId: 'case_2',
        reviewerId: 'rev-1',
        decision: 'HOLD',
        reason,
      }),
    ).toMatchObject({ caseStatus: 'UNDER_REVIEW' });
    expect((await d.compliance.findAmlAssessment('aml_1'))!.status).toBe(
      'REVIEW',
    );
    await svc.decide({
      caseId: 'case_2',
      reviewerId: 'rev-2',
      decision: 'REJECT',
      reason,
    });
    expect((await d.compliance.findAmlAssessment('aml_1'))!.status).toBe(
      'STOP',
    );
    expect(d.applications.rows.get('app_1')).toMatchObject({
      status: 'REJECTED',
      nextScreen: 'ASSISTED_ONBOARDING',
    });
    await expect(
      svc.decide({
        caseId: 'case_nope',
        reviewerId: 'rev-1',
        decision: 'PROCEED',
        reason,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // an ACTIVE application is never flipped by a late REJECT
    const b = build();
    const app = b.app();
    await b.d.applications.saveWithVersionCheck(
      { ...app, status: 'ACTIVE' },
      app.version,
    );
    await b.svc.decide({
      caseId: 'case_1',
      reviewerId: 'rev-1',
      decision: 'REJECT',
      reason,
    });
    expect(b.app().status).toBe('ACTIVE');
    // a case whose source run no longer exists still closes
    await b.d.compliance.createCase({
      id: 'case_x',
      applicationId: 'app_1',
      kind: 'SCREENING_HIT',
      sourceRunId: 'sr_gone',
      severity: 'MEDIUM',
      status: 'OPEN',
      summary: {},
      createdAt: new Date(),
    });
    expect(
      (
        await b.svc.decide({
          caseId: 'case_x',
          reviewerId: 'rev-1',
          decision: 'PROCEED',
          reason,
        })
      ).caseStatus,
    ).toBe('CLOSED');
  });
  it('bank evidence acceptance verifies the account, resolves review tasks and completes the step', async () => {
    const { d, svc } = build();
    await expect(
      svc.acceptBankEvidence({
        applicationId: 'app_1',
        verificationId: 'bv_nope',
        reviewerId: 'rev-1',
        reason,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const r = await svc.acceptBankEvidence({
      applicationId: 'app_1',
      verificationId: 'bv_1',
      reviewerId: 'rev-1',
      reason,
    });
    expect(r).toEqual({ verificationId: 'bv_1', status: 'VERIFIED' });
    expect((await d.bank.findVerification('bv_1'))!).toMatchObject({
      status: 'VERIFIED',
      safeErrorCategory: 'evidence_accepted',
    });
    expect(d.tasks.rows.find((t) => t.id === 't_bank')!.status).toBe(
      'RESOLVED',
    );
    expect(d.applications.rows.get('app_1')).toMatchObject({
      nextScreen: 'NOMINATION',
    });
    expect(d.analytics.events.at(-1)).toMatchObject({
      name: 'Bank Evidence Accepted',
      outcome: 'verified',
    });
    await expect(
      svc.acceptBankEvidence({
        applicationId: 'app_1',
        verificationId: 'bv_1',
        reviewerId: 'rev-1',
        reason,
      }),
    ).rejects.toMatchObject({
      details: { reason: 'verification_not_reviewable' },
    });
  });
  it('task resolution and reopening are audited and re-trigger activation', async () => {
    const { d, svc } = build();
    expect(
      await svc.resolveTask({
        taskId: 't_fund',
        reviewerId: 'rev-1',
        resolution: 'RESOLVED',
        reason,
      }),
    ).toEqual({ taskId: 't_fund', status: 'RESOLVED' });
    expect(
      d.tasks.rows.find((t) => t.id === 't_fund')!.resolvedAt,
    ).toBeDefined();
    await expect(
      svc.resolveTask({
        taskId: 't_fund',
        reviewerId: 'rev-1',
        resolution: 'RESOLVED',
        reason,
      }),
    ).rejects.toMatchObject({ details: { reason: 'task_already_in_status' } });
    expect(
      await svc.resolveTask({
        taskId: 't_fund',
        reviewerId: 'rev-1',
        resolution: 'REOPENED',
        reason,
      }),
    ).toEqual({ taskId: 't_fund', status: 'OPEN' });
    expect(
      d.outbox.events.filter(
        (e) => e.eventType === 'ComplianceOutcomeRecorded',
      ),
    ).toHaveLength(2);
    await expect(
      svc.resolveTask({
        taskId: 't_nope',
        reviewerId: 'rev-1',
        resolution: 'RESOLVED',
        reason,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(JSON.stringify(d.analytics.events)).not.toContain('Reviewed source');
  });
});

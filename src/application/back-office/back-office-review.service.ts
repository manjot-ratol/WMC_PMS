import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, ValidationError } from '../../common/errors/app-error';
import { completeStep } from '../../domain/onboarding/application';
import { ID_PREFIX } from '../../domain/shared/public-id';
import { isCustomerVisible } from '../../domain/tasks/task-visibility';
import { ANALYTICS, type AnalyticsPort } from '../ports/analytics.port';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepositoryPort,
} from '../ports/application.repository.port';
import { AUDIT, type AuditPort } from '../ports/audit.port';
import {
  BANK_REPOSITORY,
  type BankRepositoryPort,
} from '../ports/bank.repository.port';
import { CLOCK, type ClockPort } from '../ports/clock.port';
import {
  COMPLIANCE_REPOSITORY,
  type CaseStatus,
  type ComplianceCaseRecord,
  type ComplianceRepositoryPort,
} from '../ports/compliance.repository.port';
import { ID_GENERATOR, type IdGeneratorPort } from '../ports/id-generator.port';
import { OUTBOX, type OutboxPort } from '../ports/outbox.port';
import {
  UNIT_OF_WORK,
  type TransactionContext,
  type UnitOfWork,
} from '../ports/unit-of-work.port';
import {
  TASK_REPOSITORY,
  type TaskRecord,
  type TaskRepositoryPort,
} from '../ports/verification.repository.port';

export type Decision = 'PROCEED' | 'HOLD' | 'REJECT';
export interface DecisionCommand {
  caseId: string;
  reviewerId: string;
  decision: Decision;
  reason: string;
}
export interface BankEvidenceCommand {
  applicationId: string;
  verificationId: string;
  reviewerId: string;
  reason: string;
}
export interface TaskResolutionCommand {
  taskId: string;
  reviewerId: string;
  resolution: 'RESOLVED' | 'REOPENED';
  reason: string;
}
export interface CaseView {
  caseId: string;
  applicationId: string;
  kind: string;
  severity: string;
  status: string;
  sourceRunId: string;
  providerCaseId?: string;
  summary: Record<string, unknown>;
  createdAt: Date;
}
export interface TaskView {
  taskId: string;
  applicationId: string;
  category: string;
  status: string;
  customerVisible: boolean;
  createdAt: Date;
}
export const SCREEN_REVIEW_OPS = '22';
const MIN_REASON = 10;

/** Minimal back-office surface (owner decision §13). Every action is attributed to the reviewer id and audited. */
@Injectable()
export class BackOfficeReviewService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
    @Inject(COMPLIANCE_REPOSITORY)
    private readonly compliance: ComplianceRepositoryPort,
    @Inject(TASK_REPOSITORY) private readonly tasks: TaskRepositoryPort,
    @Inject(BANK_REPOSITORY) private readonly bank: BankRepositoryPort,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
    @Inject(ANALYTICS) private readonly analytics: AnalyticsPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
  ) {}

  async listCases(statuses: CaseStatus[], limit: number): Promise<CaseView[]> {
    const rows = await this.compliance.listCases({
      statuses,
      limit: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map(toCaseView);
  }
  async listTasks(
    statuses: TaskRecord['status'][],
    limit: number,
  ): Promise<TaskView[]> {
    const rows = await this.tasks.listByStatus(
      statuses,
      Math.min(Math.max(limit, 1), 100),
    );
    return rows.map((t) => ({
      taskId: t.id,
      applicationId: t.applicationId,
      category: t.category,
      status: t.status,
      customerVisible: isCustomerVisible(t.category),
      createdAt: t.createdAt,
    }));
  }

  async decide(
    cmd: DecisionCommand,
  ): Promise<{ caseId: string; caseStatus: CaseStatus; decisionId: string }> {
    requireReason(cmd.reason);
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const c = await this.compliance.findCase(cmd.caseId, tx);
      if (!c) throw new NotFoundError();
      if (c.status === 'CLOSED')
        throw new ValidationError(undefined, {
          details: { reason: 'case_closed' },
        });
      const decisionId = this.ids.prefixed(ID_PREFIX.reviewDecision);
      await this.compliance.createDecision(
        {
          id: decisionId,
          caseId: c.id,
          applicationId: c.applicationId,
          reviewerId: cmd.reviewerId,
          decision: cmd.decision,
          reason: cmd.reason.trim(),
          createdAt: now,
        },
        tx,
      );
      const caseStatus: CaseStatus =
        cmd.decision === 'HOLD' ? 'UNDER_REVIEW' : 'CLOSED';
      await this.compliance.updateCase(
        {
          ...c,
          status: caseStatus,
          closedAt: caseStatus === 'CLOSED' ? now : undefined,
          summary: {
            ...c.summary,
            lastDecision: cmd.decision,
            lastDecisionId: decisionId,
          },
        },
        tx,
      );
      if (cmd.decision !== 'HOLD')
        await this.applyToSource(c, cmd.decision, decisionId, now, tx);
      if (cmd.decision === 'REJECT') {
        const app = await this.applications.findById(c.applicationId, tx);
        if (app && app.status !== 'ACTIVE')
          await this.applications.saveWithVersionCheck(
            {
              ...app,
              status: 'REJECTED',
              nextScreen: 'ASSISTED_ONBOARDING',
              version: app.version + 1,
            },
            app.version,
            tx,
          );
      }
      await this.audit.append(
        {
          actorType: 'REVIEWER',
          actorId: cmd.reviewerId,
          action: 'review.decision',
          aggregateType: 'application',
          aggregateId: c.applicationId,
          details: {
            caseId: c.id,
            kind: c.kind,
            decision: cmd.decision,
            decisionId,
            reason: cmd.reason.trim(),
          },
        },
        tx,
      );
      await this.outbox.add(
        {
          aggregateType: 'application',
          aggregateId: c.applicationId,
          eventType: 'ComplianceOutcomeRecorded',
          payload: {
            applicationId: c.applicationId,
            kind: 'REVIEW',
            outcome: cmd.decision,
          },
        },
        tx,
      );
      const app = await this.applications.findById(c.applicationId, tx);
      if (app)
        await this.analytics.track(
          {
            name: 'Application Processing Updated',
            identity: app.customerId,
            applicationId: app.id,
            screenId: SCREEN_REVIEW_OPS,
            outcome: `review_${cmd.decision.toLowerCase()}`,
          },
          tx,
        );
      return { caseId: c.id, caseStatus, decisionId };
    });
  }

  /** Reviewer accepts proof of ownership for a bank account the name match could not clear. */
  async acceptBankEvidence(
    cmd: BankEvidenceCommand,
  ): Promise<{ verificationId: string; status: 'VERIFIED' }> {
    requireReason(cmd.reason);
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const app = await this.applications.findById(cmd.applicationId, tx);
      const v = await this.bank.findVerification(cmd.verificationId, tx);
      if (!app || !v || v.applicationId !== app.id) throw new NotFoundError();
      if (v.status !== 'REVIEW_REQUIRED' && v.status !== 'ACTION_REQUIRED')
        throw new ValidationError(undefined, {
          details: { reason: 'verification_not_reviewable', status: v.status },
        });
      await this.bank.updateVerification(
        {
          ...v,
          status: 'VERIFIED',
          requiredActions: [],
          safeErrorCategory: 'evidence_accepted',
          updatedAt: now,
        },
        tx,
      );
      for (const t of await this.tasks.listOpen(app.id, tx))
        if (t.category === 'BANK_NAME_REVIEW' || t.category === 'BANK_PROOF')
          await this.tasks.update(
            { ...t, status: 'RESOLVED', resolvedAt: now },
            tx,
          );
      if (app.status === 'IN_PROGRESS')
        await this.applications.saveWithVersionCheck(
          completeStep(app, 'BANK', 'NOMINATION', now),
          app.version,
          tx,
        );
      await this.audit.append(
        {
          actorType: 'REVIEWER',
          actorId: cmd.reviewerId,
          action: 'bank_evidence.accepted',
          aggregateType: 'application',
          aggregateId: app.id,
          details: { verificationId: v.id, reason: cmd.reason.trim() },
        },
        tx,
      );
      await this.analytics.track(
        {
          name: 'Bank Evidence Accepted',
          identity: app.customerId,
          applicationId: app.id,
          screenId: '15',
          outcome: 'verified',
        },
        tx,
      );
      return { verificationId: v.id, status: 'VERIFIED' };
    });
  }

  async resolveTask(
    cmd: TaskResolutionCommand,
  ): Promise<{ taskId: string; status: TaskRecord['status'] }> {
    requireReason(cmd.reason);
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const t = await this.tasks.findById(cmd.taskId, tx);
      if (!t) throw new NotFoundError();
      const status: TaskRecord['status'] =
        cmd.resolution === 'RESOLVED' ? 'RESOLVED' : 'OPEN';
      if (t.status === status)
        throw new ValidationError(undefined, {
          details: { reason: 'task_already_in_status', status },
        });
      await this.tasks.update(
        {
          ...t,
          status,
          resolvedAt: status === 'RESOLVED' ? now : undefined,
          details: { ...t.details, lastResolution: cmd.resolution },
        },
        tx,
      );
      await this.audit.append(
        {
          actorType: 'REVIEWER',
          actorId: cmd.reviewerId,
          action: 'task.resolution',
          aggregateType: 'application',
          aggregateId: t.applicationId,
          details: {
            taskId: t.id,
            category: t.category,
            resolution: cmd.resolution,
            reason: cmd.reason.trim(),
          },
        },
        tx,
      );
      await this.outbox.add(
        {
          aggregateType: 'application',
          aggregateId: t.applicationId,
          eventType: 'ComplianceOutcomeRecorded',
          payload: {
            applicationId: t.applicationId,
            kind: 'TASK',
            outcome: cmd.resolution,
          },
        },
        tx,
      );
      const app = await this.applications.findById(t.applicationId, tx);
      if (app)
        await this.analytics.track(
          {
            name: 'Application Processing Updated',
            identity: app.customerId,
            applicationId: app.id,
            screenId: SCREEN_REVIEW_OPS,
            outcome: `task_${cmd.resolution.toLowerCase()}`,
          },
          tx,
        );
      return { taskId: t.id, status };
    });
  }

  /** A documented override: the source run records the reviewer's verdict, never a silent flip. */
  private async applyToSource(
    c: ComplianceCaseRecord,
    decision: 'PROCEED' | 'REJECT',
    decisionId: string,
    now: Date,
    tx: TransactionContext,
  ): Promise<void> {
    const status = decision === 'PROCEED' ? 'PROCEED' : 'STOP';
    if (c.kind === 'SCREENING_HIT') {
      const run = await this.compliance.findScreeningRun(c.sourceRunId, tx);
      if (run)
        await this.compliance.updateScreeningRun(
          {
            ...run,
            status,
            safeErrorCategory: `review_${decision.toLowerCase()}:${decisionId}`,
            completedAt: now,
          },
          tx,
        );
    } else {
      const a = await this.compliance.findAmlAssessment(c.sourceRunId, tx);
      if (a)
        await this.compliance.updateAmlAssessment(
          {
            ...a,
            status,
            safeErrorCategory: `review_${decision.toLowerCase()}:${decisionId}`,
            completedAt: now,
          },
          tx,
        );
    }
  }
}

function requireReason(reason: string): void {
  if ((reason ?? '').trim().length < MIN_REASON)
    throw new ValidationError('A documented reason is required', {
      details: { field: 'reason', minLength: MIN_REASON },
    });
}
function toCaseView(c: ComplianceCaseRecord): CaseView {
  return {
    caseId: c.id,
    applicationId: c.applicationId,
    kind: c.kind,
    severity: c.severity,
    status: c.status,
    sourceRunId: c.sourceRunId,
    providerCaseId: c.providerCaseId,
    summary: c.summary,
    createdAt: c.createdAt,
  };
}

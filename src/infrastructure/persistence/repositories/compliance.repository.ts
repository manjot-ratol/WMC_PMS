import { Injectable } from '@nestjs/common';
import type {
  AmlAssessment as AmlRow,
  ComplianceCase as CaseRow,
  Prisma,
  ScreeningRun as RunRow,
} from '@prisma/client';
import type {
  AmlAssessmentRecord,
  CaseKind,
  CaseStatus,
  ComplianceCaseRecord,
  ComplianceKind,
  ComplianceRepositoryPort,
  ComplianceRunStatus,
  ReviewDecisionRecord,
  ScreeningRunRecord,
} from '../../../application/ports/compliance.repository.port';
import { PrismaService } from '../prisma.service';
import type { TransactionContext } from '../transaction-context';
import { clientOf } from './base.repository';

@Injectable()
export class ComplianceRepository implements ComplianceRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async createScreeningRun(
    r: ScreeningRunRecord,
    tx?: TransactionContext,
  ): Promise<void> {
    await clientOf(this.prisma, tx).screeningRun.create({
      data: {
        id: r.id,
        applicationId: r.applicationId,
        identityVersion: r.identityVersion,
        screeningPolicyVersion: r.screeningPolicyVersion,
        status: r.status,
        createdAt: r.createdAt,
      },
    });
  }
  async createAmlAssessment(
    a: AmlAssessmentRecord,
    tx?: TransactionContext,
  ): Promise<void> {
    await clientOf(this.prisma, tx).amlAssessment.create({
      data: {
        id: a.id,
        applicationId: a.applicationId,
        identityVersion: a.identityVersion,
        profileVersion: a.profileVersion,
        declarationVersion: a.declarationVersion,
        policyVersion: a.policyVersion,
        status: a.status,
        createdAt: a.createdAt,
      },
    });
  }
  async supersedeOpen(
    applicationId: string,
    tx?: TransactionContext,
    kind?: ComplianceKind,
  ): Promise<void> {
    const c = clientOf(this.prisma, tx);
    if (kind !== 'AML')
      await c.screeningRun.updateMany({
        where: { applicationId, status: { in: ['QUEUED', 'RUNNING'] } },
        data: { status: 'SUPERSEDED' },
      });
    if (kind !== 'SCREENING')
      await c.amlAssessment.updateMany({
        where: { applicationId, status: { in: ['QUEUED', 'RUNNING'] } },
        data: { status: 'SUPERSEDED' },
      });
  }
  async findScreeningRun(
    id: string,
    tx?: TransactionContext,
  ): Promise<ScreeningRunRecord | null> {
    const r = await clientOf(this.prisma, tx).screeningRun.findUnique({
      where: { id },
    });
    return r ? toRun(r) : null;
  }
  async findAmlAssessment(
    id: string,
    tx?: TransactionContext,
  ): Promise<AmlAssessmentRecord | null> {
    const r = await clientOf(this.prisma, tx).amlAssessment.findUnique({
      where: { id },
    });
    return r ? toAml(r) : null;
  }
  async updateScreeningRun(
    run: ScreeningRunRecord,
    tx?: TransactionContext,
  ): Promise<void> {
    await clientOf(this.prisma, tx).screeningRun.update({
      where: { id: run.id },
      data: {
        status: run.status,
        suggestedAction: run.suggestedAction ?? null,
        hitsCount: run.hitsCount ?? null,
        confirmedHit: run.confirmedHit ?? null,
        providerRequestId: run.providerRequestId ?? null,
        evidenceKey: run.evidenceKey ?? null,
        safeErrorCategory: run.safeErrorCategory ?? null,
        completedAt: run.completedAt ?? null,
      },
    });
  }
  async updateAmlAssessment(
    a: AmlAssessmentRecord,
    tx?: TransactionContext,
  ): Promise<void> {
    await clientOf(this.prisma, tx).amlAssessment.update({
      where: { id: a.id },
      data: {
        status: a.status,
        riskValue: a.riskValue ?? null,
        nextReviewDate: a.nextReviewDate ?? null,
        providerRequestId: a.providerRequestId ?? null,
        evidenceKey: a.evidenceKey ?? null,
        safeErrorCategory: a.safeErrorCategory ?? null,
        completedAt: a.completedAt ?? null,
      },
    });
  }
  async createCase(
    c: ComplianceCaseRecord,
    tx?: TransactionContext,
  ): Promise<void> {
    await clientOf(this.prisma, tx).complianceCase.create({
      data: {
        id: c.id,
        applicationId: c.applicationId,
        kind: c.kind,
        sourceRunId: c.sourceRunId,
        severity: c.severity,
        status: c.status,
        providerCaseId: c.providerCaseId ?? null,
        providerCaseUrl: c.providerCaseUrl ?? null,
        summary: c.summary as Prisma.InputJsonValue,
        createdAt: c.createdAt,
        closedAt: c.closedAt ?? null,
      },
    });
  }
  async findCase(
    id: string,
    tx?: TransactionContext,
  ): Promise<ComplianceCaseRecord | null> {
    const r = await clientOf(this.prisma, tx).complianceCase.findUnique({
      where: { id },
    });
    return r ? toCase(r) : null;
  }
  async listOpenCases(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<ComplianceCaseRecord[]> {
    const rows = await clientOf(this.prisma, tx).complianceCase.findMany({
      where: { applicationId, status: { not: 'CLOSED' } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toCase);
  }
  async listCases(
    filter: { statuses: CaseStatus[]; limit: number },
    tx?: TransactionContext,
  ): Promise<ComplianceCaseRecord[]> {
    const rows = await clientOf(this.prisma, tx).complianceCase.findMany({
      where: { status: { in: filter.statuses } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: filter.limit,
    });
    return rows.map(toCase);
  }
  async updateCase(
    c: ComplianceCaseRecord,
    tx?: TransactionContext,
  ): Promise<void> {
    await clientOf(this.prisma, tx).complianceCase.update({
      where: { id: c.id },
      data: {
        status: c.status,
        summary: c.summary as Prisma.InputJsonValue,
        closedAt: c.closedAt ?? null,
      },
    });
  }
  async createDecision(
    d: ReviewDecisionRecord,
    tx?: TransactionContext,
  ): Promise<void> {
    await clientOf(this.prisma, tx).reviewDecision.create({ data: { ...d } });
  }
  async latestScreeningRun(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<ScreeningRunRecord | null> {
    const r = await clientOf(this.prisma, tx).screeningRun.findFirst({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
    });
    return r ? toRun(r) : null;
  }
  async latestAmlAssessment(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<AmlAssessmentRecord | null> {
    const r = await clientOf(this.prisma, tx).amlAssessment.findFirst({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
    });
    return r ? toAml(r) : null;
  }
}
function toRun(r: RunRow): ScreeningRunRecord {
  return {
    id: r.id,
    applicationId: r.applicationId,
    identityVersion: r.identityVersion,
    screeningPolicyVersion: r.screeningPolicyVersion,
    status: r.status as ComplianceRunStatus,
    suggestedAction: r.suggestedAction ?? undefined,
    hitsCount: r.hitsCount ?? undefined,
    confirmedHit: r.confirmedHit ?? undefined,
    providerRequestId: r.providerRequestId ?? undefined,
    evidenceKey: r.evidenceKey ?? undefined,
    safeErrorCategory: r.safeErrorCategory ?? undefined,
    createdAt: r.createdAt,
    completedAt: r.completedAt ?? undefined,
  };
}
function toAml(r: AmlRow): AmlAssessmentRecord {
  return {
    id: r.id,
    applicationId: r.applicationId,
    identityVersion: r.identityVersion,
    profileVersion: r.profileVersion,
    declarationVersion: r.declarationVersion,
    policyVersion: r.policyVersion,
    status: r.status as ComplianceRunStatus,
    riskValue: r.riskValue ?? undefined,
    nextReviewDate: r.nextReviewDate ?? undefined,
    providerRequestId: r.providerRequestId ?? undefined,
    evidenceKey: r.evidenceKey ?? undefined,
    safeErrorCategory: r.safeErrorCategory ?? undefined,
    createdAt: r.createdAt,
    completedAt: r.completedAt ?? undefined,
  };
}
function toCase(r: CaseRow): ComplianceCaseRecord {
  return {
    id: r.id,
    applicationId: r.applicationId,
    kind: r.kind as CaseKind,
    sourceRunId: r.sourceRunId,
    severity: r.severity as ComplianceCaseRecord['severity'],
    status: r.status as CaseStatus,
    providerCaseId: r.providerCaseId ?? undefined,
    providerCaseUrl: r.providerCaseUrl ?? undefined,
    summary: r.summary as Record<string, unknown>,
    createdAt: r.createdAt,
    closedAt: r.closedAt ?? undefined,
  };
}

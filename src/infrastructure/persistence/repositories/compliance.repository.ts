import { Injectable } from '@nestjs/common';
import type {
  AmlAssessment as AmlRow,
  ScreeningRun as RunRow,
} from '@prisma/client';
import type {
  AmlAssessmentRecord,
  ComplianceRepositoryPort,
  ComplianceRunStatus,
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
  ): Promise<void> {
    const c = clientOf(this.prisma, tx);
    await c.screeningRun.updateMany({
      where: { applicationId, status: { in: ['QUEUED', 'RUNNING'] } },
      data: { status: 'SUPERSEDED' },
    });
    await c.amlAssessment.updateMany({
      where: { applicationId, status: { in: ['QUEUED', 'RUNNING'] } },
      data: { status: 'SUPERSEDED' },
    });
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

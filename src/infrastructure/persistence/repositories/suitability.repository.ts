import { Injectable } from '@nestjs/common';
import type {
  InvestmentApproach as ApproachRow,
  Prisma,
  SuitabilityAssessment as AssessmentRow,
} from '@prisma/client';
import type { SuitabilityRepositoryPort } from '../../../application/ports/suitability.repository.port';
import type {
  Answer,
  AssessmentStatus,
  InvestmentApproach,
  SuitabilityAssessment,
} from '../../../domain/suitability/suitability';
import { PrismaService } from '../prisma.service';
import type { TransactionContext } from '../transaction-context';
import { clientOf } from './base.repository';

@Injectable()
export class SuitabilityRepository implements SuitabilityRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async appendAssessment(
    a: SuitabilityAssessment,
    tx?: TransactionContext,
  ): Promise<void> {
    await clientOf(this.prisma, tx).suitabilityAssessment.create({
      data: {
        id: a.id,
        applicationId: a.applicationId,
        version: a.version,
        questionnaireVersion: a.questionnaireVersion,
        answers: a.answers as unknown as Prisma.InputJsonValue,
        status: a.status,
        score: a.score ?? null,
        riskProfile: a.riskProfile ?? null,
        permittedApproachCodes: a.permittedApproachCodes,
        missingQuestionIds: a.missingQuestionIds,
        createdAt: a.createdAt,
      },
    });
  }
  async findAssessment(
    id: string,
    tx?: TransactionContext,
  ): Promise<SuitabilityAssessment | null> {
    const r = await clientOf(this.prisma, tx).suitabilityAssessment.findUnique({
      where: { id },
    });
    return r ? toAssessment(r) : null;
  }
  async latestAssessment(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<SuitabilityAssessment | null> {
    const r = await clientOf(this.prisma, tx).suitabilityAssessment.findFirst({
      where: { applicationId },
      orderBy: { version: 'desc' },
    });
    return r ? toAssessment(r) : null;
  }
  async appendApproach(
    a: InvestmentApproach,
    tx?: TransactionContext,
  ): Promise<void> {
    await clientOf(this.prisma, tx).investmentApproach.create({
      data: { ...a },
    });
  }
  async latestApproach(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<InvestmentApproach | null> {
    const r = await clientOf(this.prisma, tx).investmentApproach.findFirst({
      where: { applicationId },
      orderBy: { version: 'desc' },
    });
    return r ? toApproach(r) : null;
  }
}

function toAssessment(r: AssessmentRow): SuitabilityAssessment {
  return {
    id: r.id,
    applicationId: r.applicationId,
    version: r.version,
    questionnaireVersion: r.questionnaireVersion,
    answers: r.answers as unknown as Answer[],
    status: r.status as AssessmentStatus,
    score: r.score ?? undefined,
    riskProfile: r.riskProfile ?? undefined,
    permittedApproachCodes: r.permittedApproachCodes as string[],
    missingQuestionIds: r.missingQuestionIds as string[],
    createdAt: r.createdAt,
  };
}
function toApproach(r: ApproachRow): InvestmentApproach {
  return {
    applicationId: r.applicationId,
    version: r.version,
    assessmentId: r.assessmentId,
    assessmentVersion: r.assessmentVersion,
    approachCode: r.approachCode,
    confirmedAt: r.confirmedAt,
  };
}

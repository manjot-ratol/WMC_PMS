import { Injectable } from '@nestjs/common';
import type { EligibilityDecision as Row } from '@prisma/client';
import type {
  EligibilityDecisionRecord,
  EligibilityRepositoryPort,
} from '../../../application/ports/eligibility.repository.port';
import type {
  EligibilityInput,
  EligibilityStatus,
} from '../../../domain/eligibility/eligibility-engine';
import type { Screen } from '../../../domain/onboarding/screens';
import { PrismaService } from '../prisma.service';
import type { TransactionContext } from '../transaction-context';
import { clientOf } from './base.repository';

@Injectable()
export class EligibilityRepository implements EligibilityRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async append(
    d: EligibilityDecisionRecord,
    tx?: TransactionContext,
  ): Promise<void> {
    await clientOf(this.prisma, tx).eligibilityDecision.create({
      data: {
        id: d.id,
        applicationId: d.applicationId,
        version: d.version,
        customerType: d.input.customerType,
        residentialStatus: d.input.residentialStatus,
        intendedInvestmentInr: BigInt(d.input.intendedInvestmentInr),
        distributionRoute: d.input.distributionRoute,
        status: d.status,
        rulesetVersion: d.rulesetVersion,
        journeyRoute: d.journeyRoute ?? null,
        reasons: d.reasons,
        decidedAt: d.decidedAt,
      },
    });
  }

  async latest(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<EligibilityDecisionRecord | null> {
    const row = await clientOf(this.prisma, tx).eligibilityDecision.findFirst({
      where: { applicationId },
      orderBy: { version: 'desc' },
    });
    return row ? toDomain(row) : null;
  }
}

function toDomain(r: Row): EligibilityDecisionRecord {
  const status = r.status as EligibilityStatus;
  return {
    id: r.id,
    applicationId: r.applicationId,
    version: r.version,
    status,
    rulesetVersion: r.rulesetVersion,
    journeyRoute: r.journeyRoute ?? undefined,
    reasons: r.reasons as string[],
    decidedAt: r.decidedAt,
    nextScreen:
      status === 'ELIGIBLE'
        ? 'PAN_IDENTITY'
        : status === 'ASSISTED_REQUIRED'
          ? 'ASSISTED_ONBOARDING'
          : 'NOT_ELIGIBLE',
    input: {
      customerType: r.customerType as EligibilityInput['customerType'],
      residentialStatus:
        r.residentialStatus as EligibilityInput['residentialStatus'],
      intendedInvestmentInr: Number(r.intendedInvestmentInr),
      distributionRoute:
        r.distributionRoute as EligibilityInput['distributionRoute'],
    },
  };
}

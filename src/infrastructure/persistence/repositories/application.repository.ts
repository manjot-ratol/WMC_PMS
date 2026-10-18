import { Injectable } from '@nestjs/common';
import type {
  ApplicationStep as StepRow,
  OnboardingApplication as Row,
} from '@prisma/client';
import type { ApplicationRepositoryPort } from '../../../application/ports/application.repository.port';
import { StaleVersionError } from '../../../common/errors/app-error';
import type {
  ApplicationStatus,
  OnboardingApplication,
} from '../../../domain/onboarding/application';
import type {
  ApplicationStep,
  StepStatus,
} from '../../../domain/onboarding/application-step';
import type { Screen, StepId } from '../../../domain/onboarding/screens';
import { PrismaService } from '../prisma.service';
import type { TransactionContext } from '../transaction-context';
import { clientOf } from './base.repository';

@Injectable()
export class ApplicationRepository implements ApplicationRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findById(
    id: string,
    tx?: TransactionContext,
  ): Promise<OnboardingApplication | null> {
    const row = await clientOf(
      this.prisma,
      tx,
    ).onboardingApplication.findUnique({
      where: { id },
      include: { steps: true },
    });
    return row ? toDomain(row) : null;
  }

  async findInProgressByCustomer(
    customerId: string,
    tx?: TransactionContext,
  ): Promise<OnboardingApplication | null> {
    const row = await clientOf(this.prisma, tx).onboardingApplication.findFirst(
      {
        where: { customerId, status: 'IN_PROGRESS' },
        include: { steps: true },
      },
    );
    return row ? toDomain(row) : null;
  }

  async listIdsByCustomer(
    customerId: string,
    tx?: TransactionContext,
  ): Promise<string[]> {
    const rows = await clientOf(this.prisma, tx).onboardingApplication.findMany(
      {
        where: { customerId },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      },
    );
    return rows.map((r) => r.id);
  }

  async create(
    app: OnboardingApplication,
    tx?: TransactionContext,
  ): Promise<void> {
    await clientOf(this.prisma, tx).onboardingApplication.create({
      data: {
        id: app.id,
        customerId: app.customerId,
        status: app.status,
        journeyVersion: app.journeyVersion,
        nextScreen: app.nextScreen,
        version: app.version,
        createdAt: app.createdAt,
        steps: { create: app.steps.map(stepColumns) },
      },
    });
  }

  async saveWithVersionCheck(
    app: OnboardingApplication,
    expectedVersion: number,
    tx?: TransactionContext,
  ): Promise<void> {
    const client = clientOf(this.prisma, tx);
    const result = await client.onboardingApplication.updateMany({
      where: { id: app.id, version: expectedVersion },
      data: {
        status: app.status,
        nextScreen: app.nextScreen,
        version: app.version,
      },
    });
    if (result.count !== 1)
      throw new StaleVersionError(undefined, {
        details: { aggregate: 'application', id: app.id },
      });
    for (const step of app.steps) {
      await client.applicationStep.upsert({
        where: {
          applicationId_stepId: { applicationId: app.id, stepId: step.stepId },
        },
        create: { applicationId: app.id, ...stepColumns(step) },
        update: stepColumns(step),
      });
    }
  }
}

function stepColumns(s: ApplicationStep) {
  return {
    stepId: s.stepId,
    status: s.status,
    version: s.version,
    completedAt: s.completedAt ?? null,
  };
}

function toDomain(r: Row & { steps: StepRow[] }): OnboardingApplication {
  return {
    id: r.id,
    customerId: r.customerId,
    status: r.status as ApplicationStatus,
    journeyVersion: r.journeyVersion,
    nextScreen: r.nextScreen as Screen,
    version: r.version,
    createdAt: r.createdAt,
    steps: r.steps.map((s) => ({
      stepId: s.stepId as StepId,
      status: s.status as StepStatus,
      version: s.version,
      completedAt: s.completedAt ?? undefined,
    })),
  };
}

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ActivationRepositoryPort } from '../../../application/ports/activation.repository.port';
import type { Activation } from '../../../domain/activation/activation';
import { PrismaService } from '../prisma.service';
import type { TransactionContext } from '../transaction-context';
import { clientOf } from './base.repository';

@Injectable()
export class ActivationRepository implements ActivationRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async create(a: Activation, tx?: TransactionContext): Promise<void> {
    await clientOf(this.prisma, tx).activation.create({
      data: {
        id: a.id,
        applicationId: a.applicationId,
        pmsAccountId: a.pmsAccountId,
        gateSnapshot: a.gateSnapshot as Prisma.InputJsonValue,
        activatedAt: a.activatedAt,
      },
    });
  }
  async findByApplication(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<Activation | null> {
    const r = await clientOf(this.prisma, tx).activation.findUnique({
      where: { applicationId },
    });
    return r
      ? {
          id: r.id,
          applicationId: r.applicationId,
          pmsAccountId: r.pmsAccountId,
          gateSnapshot: r.gateSnapshot as Record<string, unknown>,
          activatedAt: r.activatedAt,
        }
      : null;
  }
}

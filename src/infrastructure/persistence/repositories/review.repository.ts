import { Injectable } from '@nestjs/common';
import type { Prisma, ReviewSnapshot as Row } from '@prisma/client';
import type { ReviewRepositoryPort } from '../../../application/ports/review.repository.port';
import type {
  ReviewSections,
  ReviewSnapshot,
  SnapshotStatus,
} from '../../../domain/review/review-snapshot';
import { PrismaService } from '../prisma.service';
import type { TransactionContext } from '../transaction-context';
import { clientOf } from './base.repository';

@Injectable()
export class ReviewRepository implements ReviewRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async create(s: ReviewSnapshot, tx?: TransactionContext): Promise<void> {
    await clientOf(this.prisma, tx).reviewSnapshot.create({
      data: {
        id: s.id,
        applicationId: s.applicationId,
        confirmedApplicationVersion: s.confirmedApplicationVersion,
        applicationVersion: s.applicationVersion,
        documentPackVersion: s.documentPackVersion,
        sections: s.sections as unknown as Prisma.InputJsonValue,
        hash: s.hash,
        status: s.status,
        confirmedAt: s.confirmedAt,
      },
    });
  }
  async findById(
    id: string,
    tx?: TransactionContext,
  ): Promise<ReviewSnapshot | null> {
    const r = await clientOf(this.prisma, tx).reviewSnapshot.findUnique({
      where: { id },
    });
    return r ? toDomain(r) : null;
  }
  async current(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<ReviewSnapshot | null> {
    const r = await clientOf(this.prisma, tx).reviewSnapshot.findFirst({
      where: { applicationId, status: 'CURRENT' },
      orderBy: { confirmedAt: 'desc' },
    });
    return r ? toDomain(r) : null;
  }
  async supersedeCurrent(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<void> {
    await clientOf(this.prisma, tx).reviewSnapshot.updateMany({
      where: { applicationId, status: 'CURRENT' },
      data: { status: 'SUPERSEDED' },
    });
  }
}

function toDomain(r: Row): ReviewSnapshot {
  return {
    id: r.id,
    applicationId: r.applicationId,
    confirmedApplicationVersion: r.confirmedApplicationVersion,
    applicationVersion: r.applicationVersion,
    documentPackVersion: r.documentPackVersion,
    sections: r.sections as unknown as ReviewSections,
    hash: r.hash,
    status: r.status as SnapshotStatus,
    confirmedAt: r.confirmedAt,
  };
}

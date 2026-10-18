import { Injectable } from '@nestjs/common';
import type { AuthChallenge as Row } from '@prisma/client';
import type { ChallengeRepositoryPort } from '../../../application/ports/challenge.repository.port';
import { CorrelationStore } from '../../../common/correlation/correlation.store';
import type {
  Challenge,
  ChallengeChannel,
  ChallengePurpose,
  ChallengeStatus,
} from '../../../domain/identity/challenge';
import { PrismaService } from '../prisma.service';
import type { TransactionContext } from '../transaction-context';
import { clientOf } from './base.repository';

@Injectable()
export class ChallengeRepository implements ChallengeRepositoryPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: CorrelationStore,
  ) {}

  async create(c: Challenge, tx?: TransactionContext): Promise<void> {
    await clientOf(this.prisma, tx).authChallenge.create({
      data: {
        id: c.id,
        channel: c.channel,
        purpose: c.purpose,
        targetFingerprint: c.targetFingerprint,
        customerId: c.customerId ?? null,
        applicationId: c.applicationId ?? null,
        status: c.status,
        maxAttempts: c.maxAttempts,
        createdAt: c.createdAt,
        expiresAt: c.expiresAt,
        resendAfter: c.resendAfter,
        verifiedAt: c.verifiedAt ?? null,
        correlationId: this.store.getCorrelationId(),
      },
    });
  }

  async findById(
    id: string,
    tx?: TransactionContext,
  ): Promise<Challenge | null> {
    const row = await clientOf(this.prisma, tx).authChallenge.findUnique({
      where: { id },
    });
    return row ? toDomain(row) : null;
  }

  async update(c: Challenge, tx?: TransactionContext): Promise<void> {
    await clientOf(this.prisma, tx).authChallenge.update({
      where: { id: c.id },
      data: { status: c.status, verifiedAt: c.verifiedAt ?? null },
    });
  }
}

function toDomain(r: Row): Challenge {
  return {
    id: r.id,
    channel: r.channel as ChallengeChannel,
    purpose: r.purpose as ChallengePurpose,
    targetFingerprint: r.targetFingerprint,
    customerId: r.customerId ?? undefined,
    applicationId: r.applicationId ?? undefined,
    status: r.status as ChallengeStatus,
    maxAttempts: r.maxAttempts,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    resendAfter: r.resendAfter,
    verifiedAt: r.verifiedAt ?? undefined,
  };
}

import { Injectable } from '@nestjs/common';
import type {
  SessionRecord,
  SessionRepositoryPort,
} from '../../../application/ports/session.repository.port';
import { PrismaService } from '../prisma.service';
import type { TransactionContext } from '../transaction-context';
import { clientOf } from './base.repository';

@Injectable()
export class SessionRepository implements SessionRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async create(s: SessionRecord, tx?: TransactionContext): Promise<void> {
    await clientOf(this.prisma, tx).session.create({
      data: {
        id: s.id,
        tokenHash: s.tokenHash,
        customerId: s.customerId,
        expiresAt: s.expiresAt,
      },
    });
  }

  async revoke(tokenHash: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

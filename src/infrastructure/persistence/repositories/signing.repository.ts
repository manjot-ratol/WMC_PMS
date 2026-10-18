import { Injectable } from '@nestjs/common';
import type { Prisma, SigningSession as Row } from '@prisma/client';
import type { SigningRepositoryPort } from '../../../application/ports/signing.repository.port';
import type {
  SigningDocument,
  SigningMethod,
  SigningSession,
  SigningSessionStatus,
} from '../../../domain/signing/signing-session';
import { PrismaService } from '../prisma.service';
import type { TransactionContext } from '../transaction-context';
import { clientOf } from './base.repository';

@Injectable()
export class SigningRepository implements SigningRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async create(s: SigningSession, tx?: TransactionContext): Promise<void> {
    await clientOf(this.prisma, tx).signingSession.create({ data: toRow(s) });
  }
  async findById(
    id: string,
    tx?: TransactionContext,
  ): Promise<SigningSession | null> {
    const r = await clientOf(this.prisma, tx).signingSession.findUnique({
      where: { id },
    });
    return r ? toDomain(r) : null;
  }
  async findByProviderRequestId(
    providerRequestId: string,
    tx?: TransactionContext,
  ): Promise<SigningSession | null> {
    const r = await clientOf(this.prisma, tx).signingSession.findFirst({
      where: { providerRequestId },
      orderBy: { createdAt: 'desc' },
    });
    return r ? toDomain(r) : null;
  }
  async latestForSnapshot(
    snapshotId: string,
    tx?: TransactionContext,
  ): Promise<SigningSession | null> {
    const r = await clientOf(this.prisma, tx).signingSession.findFirst({
      where: { snapshotId },
      orderBy: { createdAt: 'desc' },
    });
    return r ? toDomain(r) : null;
  }
  async latestForApplication(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<SigningSession | null> {
    const r = await clientOf(this.prisma, tx).signingSession.findFirst({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
    });
    return r ? toDomain(r) : null;
  }
  async update(s: SigningSession, tx?: TransactionContext): Promise<void> {
    const { id, ...data } = toRow(s);
    await clientOf(this.prisma, tx).signingSession.update({
      where: { id },
      data,
    });
  }
}

function toRow(s: SigningSession) {
  return {
    id: s.id,
    applicationId: s.applicationId,
    snapshotId: s.snapshotId,
    documentPackVersion: s.documentPackVersion,
    signingMethod: s.signingMethod,
    status: s.status,
    providerRequestId: s.providerRequestId ?? null,
    packObjectKey: s.packObjectKey,
    packSha256: s.packSha256,
    documents: s.documents as unknown as Prisma.InputJsonValue,
    pollCount: s.pollCount,
    lastProviderStatus: s.lastProviderStatus ?? null,
    safeErrorCategory: s.safeErrorCategory ?? null,
    evidenceKey: s.evidenceKey ?? null,
    createdAt: s.createdAt,
    executedAt: s.executedAt ?? null,
  };
}
function toDomain(r: Row): SigningSession {
  return {
    id: r.id,
    applicationId: r.applicationId,
    snapshotId: r.snapshotId,
    documentPackVersion: r.documentPackVersion,
    signingMethod: r.signingMethod as SigningMethod,
    status: r.status as SigningSessionStatus,
    providerRequestId: r.providerRequestId ?? undefined,
    packObjectKey: r.packObjectKey,
    packSha256: r.packSha256,
    documents: r.documents as unknown as SigningDocument[],
    pollCount: r.pollCount,
    lastProviderStatus: r.lastProviderStatus ?? undefined,
    safeErrorCategory: r.safeErrorCategory ?? undefined,
    evidenceKey: r.evidenceKey ?? undefined,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    executedAt: r.executedAt ?? undefined,
  };
}

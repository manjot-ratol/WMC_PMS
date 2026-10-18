import { Injectable } from '@nestjs/common';
import type {
  KycRecord as RecordRow,
  KycSession as SessionRow,
  Prisma,
} from '@prisma/client';
import type {
  KycRecordRepositoryPort,
  KycSessionRepositoryPort,
} from '../../../application/ports/kyc.repository.port';
import { StaleVersionError } from '../../../common/errors/app-error';
import type {
  KraSummary,
  KycRecord,
  KycRoute,
  KycStatus,
} from '../../../domain/kyc/kyc-record';
import type {
  KycSession,
  KycSessionStatus,
} from '../../../domain/kyc/kyc-session';
import { PrismaService } from '../prisma.service';
import type { TransactionContext } from '../transaction-context';
import { clientOf } from './base.repository';

@Injectable()
export class KycRecordRepository implements KycRecordRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async create(r: KycRecord, tx?: TransactionContext): Promise<void> {
    await clientOf(this.prisma, tx).kycRecord.create({
      data: {
        id: r.id,
        applicationId: r.applicationId,
        identityVersion: r.identityVersion,
        provider: r.provider,
        operationId: r.operationId,
        ...columns(r),
      },
    });
  }
  async findById(
    id: string,
    tx?: TransactionContext,
  ): Promise<KycRecord | null> {
    const row = await clientOf(this.prisma, tx).kycRecord.findUnique({
      where: { id },
    });
    return row ? toRecord(row) : null;
  }
  async latestForApplication(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<KycRecord | null> {
    const row = await clientOf(this.prisma, tx).kycRecord.findFirst({
      where: { applicationId },
      orderBy: { identityVersion: 'desc' },
    });
    return row ? toRecord(row) : null;
  }
  async saveWithVersionCheck(
    r: KycRecord,
    expectedVersion: number,
    tx?: TransactionContext,
  ): Promise<void> {
    const result = await clientOf(this.prisma, tx).kycRecord.updateMany({
      where: { id: r.id, version: expectedVersion },
      data: columns(r),
    });
    if (result.count !== 1)
      throw new StaleVersionError(undefined, {
        details: { aggregate: 'kyc_record', id: r.id },
      });
  }
}

function columns(r: KycRecord) {
  return {
    status: r.status,
    route: r.route ?? null,
    version: r.version,
    summary: (r.summary ?? undefined) as Prisma.InputJsonValue | undefined,
    evidenceKey: r.evidenceKey ?? null,
    ipvExemptionBasis: r.ipvExemptionBasis ?? null,
    safeErrorCategory: r.safeErrorCategory ?? null,
    confirmedAt: r.confirmedAt ?? null,
  };
}
function toRecord(r: RecordRow): KycRecord {
  return {
    id: r.id,
    applicationId: r.applicationId,
    identityVersion: r.identityVersion,
    provider: r.provider as KycRecord['provider'],
    status: r.status as KycStatus,
    route: (r.route ?? undefined) as KycRoute | undefined,
    operationId: r.operationId,
    version: r.version,
    summary: (r.summary ?? undefined) as KraSummary | undefined,
    evidenceKey: r.evidenceKey ?? undefined,
    ipvExemptionBasis: r.ipvExemptionBasis ?? undefined,
    safeErrorCategory: r.safeErrorCategory ?? undefined,
    confirmedAt: r.confirmedAt ?? undefined,
    updatedAt: r.updatedAt,
  };
}

@Injectable()
export class KycSessionRepository implements KycSessionRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async create(s: KycSession, tx?: TransactionContext): Promise<void> {
    await clientOf(this.prisma, tx).kycSession.create({
      data: {
        id: s.id,
        applicationId: s.applicationId,
        provider: s.provider,
        templateName: s.templateName,
        createdAt: s.createdAt,
        ...sessionColumns(s),
      },
    });
  }
  async findById(
    id: string,
    tx?: TransactionContext,
  ): Promise<KycSession | null> {
    const row = await clientOf(this.prisma, tx).kycSession.findUnique({
      where: { id },
    });
    return row ? toSession(row) : null;
  }
  async findByProviderRequestId(
    providerRequestId: string,
    tx?: TransactionContext,
  ): Promise<KycSession | null> {
    const row = await clientOf(this.prisma, tx).kycSession.findFirst({
      where: { providerRequestId },
    });
    return row ? toSession(row) : null;
  }
  async latestForApplication(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<KycSession | null> {
    const row = await clientOf(this.prisma, tx).kycSession.findFirst({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toSession(row) : null;
  }
  async update(s: KycSession, tx?: TransactionContext): Promise<void> {
    await clientOf(this.prisma, tx).kycSession.update({
      where: { id: s.id },
      data: sessionColumns(s),
    });
  }
}
function sessionColumns(s: KycSession) {
  return {
    providerRequestId: s.providerRequestId ?? null,
    status: s.status,
    lastProviderStatus: s.lastProviderStatus ?? null,
    pollCount: s.pollCount,
    safeErrorCategory: s.safeErrorCategory ?? null,
    completedAt: s.completedAt ?? null,
  };
}
function toSession(r: SessionRow): KycSession {
  return {
    id: r.id,
    applicationId: r.applicationId,
    provider: 'DIGIO',
    providerRequestId: r.providerRequestId ?? undefined,
    templateName: r.templateName,
    status: r.status as KycSessionStatus,
    lastProviderStatus: r.lastProviderStatus ?? undefined,
    pollCount: r.pollCount,
    safeErrorCategory: r.safeErrorCategory ?? undefined,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    completedAt: r.completedAt ?? undefined,
  };
}

import { Injectable } from '@nestjs/common';
import type {
  AdditionalVerification as Row,
  Prisma,
  Task as TaskRow,
} from '@prisma/client';
import type {
  TaskRecord,
  TaskRepositoryPort,
  TaskResponseRecord,
  VerificationRepositoryPort,
} from '../../../application/ports/verification.repository.port';
import { FieldCipher } from '../../../common/crypto/field-cipher';
import type {
  AdditionalVerification,
  VerificationStatus,
  VerificationType,
} from '../../../domain/ipv/additional-verification';
import { PrismaService } from '../prisma.service';
import type { TransactionContext } from '../transaction-context';
import { clientOf } from './base.repository';

@Injectable()
export class VerificationRepository implements VerificationRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    v: AdditionalVerification,
    tx?: TransactionContext,
  ): Promise<void> {
    await clientOf(this.prisma, tx).additionalVerification.create({
      data: {
        id: v.id,
        applicationId: v.applicationId,
        type: v.type,
        thresholdVersion: v.thresholdVersion,
        createdAt: v.createdAt,
        ...cols(v),
      },
    });
  }
  async findById(
    id: string,
    tx?: TransactionContext,
  ): Promise<AdditionalVerification | null> {
    const row = await clientOf(
      this.prisma,
      tx,
    ).additionalVerification.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }
  async latestForApplication(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<AdditionalVerification | null> {
    const row = await clientOf(
      this.prisma,
      tx,
    ).additionalVerification.findFirst({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toDomain(row) : null;
  }
  async update(
    v: AdditionalVerification,
    tx?: TransactionContext,
  ): Promise<void> {
    await clientOf(this.prisma, tx).additionalVerification.update({
      where: { id: v.id },
      data: cols(v),
    });
  }
  countByType(
    applicationId: string,
    type: VerificationType,
    tx?: TransactionContext,
  ): Promise<number> {
    return clientOf(this.prisma, tx).additionalVerification.count({
      where: { applicationId, type },
    });
  }
}
function cols(v: AdditionalVerification) {
  return {
    status: v.status,
    selfieDocumentId: v.selfieDocumentId ?? null,
    referenceDocumentId: v.referenceDocumentId ?? null,
    providerSessionId: v.providerSessionId ?? null,
    exemptionBasis: v.exemptionBasis ?? null,
    livenessScore: v.livenessScore ?? null,
    faceMatchConfidence: v.faceMatchConfidence ?? null,
    safeErrorCategory: v.safeErrorCategory ?? null,
  };
}
function toDomain(r: Row): AdditionalVerification {
  return {
    id: r.id,
    applicationId: r.applicationId,
    type: r.type as VerificationType,
    status: r.status as VerificationStatus,
    selfieDocumentId: r.selfieDocumentId ?? undefined,
    referenceDocumentId: r.referenceDocumentId ?? undefined,
    providerSessionId: r.providerSessionId ?? undefined,
    exemptionBasis: r.exemptionBasis ?? undefined,
    livenessScore: r.livenessScore ?? undefined,
    faceMatchConfidence: r.faceMatchConfidence ?? undefined,
    thresholdVersion: r.thresholdVersion,
    safeErrorCategory: r.safeErrorCategory ?? undefined,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

@Injectable()
export class TaskRepository implements TaskRepositoryPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
  ) {}
  async findById(
    id: string,
    tx?: TransactionContext,
  ): Promise<TaskRecord | null> {
    const r = await clientOf(this.prisma, tx).task.findUnique({
      where: { id },
    });
    return r ? toTask(r) : null;
  }
  async update(t: TaskRecord, tx?: TransactionContext): Promise<void> {
    await clientOf(this.prisma, tx).task.update({
      where: { id: t.id },
      data: {
        status: t.status,
        details: (t.details ?? undefined) as Prisma.InputJsonValue | undefined,
        resolvedAt: t.resolvedAt ?? null,
      },
    });
  }
  async createResponse(
    r: TaskResponseRecord,
    tx?: TransactionContext,
  ): Promise<void> {
    await clientOf(this.prisma, tx).taskResponse.create({
      data: {
        id: r.id,
        taskId: r.taskId,
        applicationId: r.applicationId,
        responseType: r.responseType,
        documentIds: r.documentIds,
        text: r.text
          ? new Uint8Array(this.cipher.encryptToBuffer(r.text))
          : null,
        submittedAt: r.submittedAt,
      },
    });
  }
  async create(t: TaskRecord, tx?: TransactionContext): Promise<void> {
    await clientOf(this.prisma, tx).task.create({
      data: {
        id: t.id,
        applicationId: t.applicationId,
        category: t.category,
        status: t.status,
        details: (t.details ?? undefined) as Prisma.InputJsonValue | undefined,
        createdAt: t.createdAt,
      },
    });
  }
  async listOpen(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<TaskRecord[]> {
    const rows = await clientOf(this.prisma, tx).task.findMany({
      where: { applicationId, status: { not: 'RESOLVED' } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toTask);
  }
}

function toTask(r: TaskRow): TaskRecord {
  return {
    id: r.id,
    applicationId: r.applicationId,
    category: r.category,
    status: r.status as TaskRecord['status'],
    details: (r.details ?? undefined) as Record<string, unknown> | undefined,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt ?? undefined,
  };
}

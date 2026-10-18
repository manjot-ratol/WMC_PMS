import { Injectable } from '@nestjs/common';
import type {
  Document as DocRow,
  DocumentUpload as UploadRow,
  Prisma,
} from '@prisma/client';
import type { DocumentRepositoryPort } from '../../../application/ports/document.repository.port';
import type {
  Document,
  DocumentFile,
  DocumentStatus,
  DocumentUpload,
  UploadStatus,
} from '../../../domain/documents/document';
import { PrismaService } from '../prisma.service';
import type { TransactionContext } from '../transaction-context';
import { clientOf } from './base.repository';

@Injectable()
export class DocumentRepository implements DocumentRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async createUpload(
    u: DocumentUpload,
    tx?: TransactionContext,
  ): Promise<void> {
    await clientOf(this.prisma, tx).documentUpload.create({
      data: {
        id: u.id,
        applicationId: u.applicationId,
        requirementId: u.requirementId,
        objectKey: u.objectKey,
        declaredContentType: u.declaredContentType,
        declaredSizeBytes: u.declaredSizeBytes,
        status: u.status,
        expiresAt: u.expiresAt,
        createdAt: u.createdAt,
      },
    });
  }
  async findUpload(
    id: string,
    tx?: TransactionContext,
  ): Promise<DocumentUpload | null> {
    const row = await clientOf(this.prisma, tx).documentUpload.findUnique({
      where: { id },
    });
    return row ? toUpload(row) : null;
  }
  async updateUpload(
    u: DocumentUpload,
    tx?: TransactionContext,
  ): Promise<void> {
    await clientOf(this.prisma, tx).documentUpload.update({
      where: { id: u.id },
      data: { status: u.status },
    });
  }
  async createDocument(d: Document, tx?: TransactionContext): Promise<void> {
    await clientOf(this.prisma, tx).document.create({
      data: {
        id: d.id,
        applicationId: d.applicationId,
        requirementId: d.requirementId,
        documentType: d.documentType,
        files: d.files as unknown as Prisma.InputJsonValue,
        status: d.status,
        operationId: d.operationId,
        safeErrorCategory: d.safeErrorCategory ?? null,
        createdAt: d.createdAt,
      },
    });
  }
  async findDocument(
    id: string,
    tx?: TransactionContext,
  ): Promise<Document | null> {
    const row = await clientOf(this.prisma, tx).document.findUnique({
      where: { id },
    });
    return row ? toDoc(row) : null;
  }
  async updateDocument(d: Document, tx?: TransactionContext): Promise<void> {
    await clientOf(this.prisma, tx).document.update({
      where: { id: d.id },
      data: {
        files: d.files as unknown as Prisma.InputJsonValue,
        status: d.status,
        safeErrorCategory: d.safeErrorCategory ?? null,
      },
    });
  }
  async latestVerified(
    applicationId: string,
    requirementId: string,
    tx?: TransactionContext,
  ): Promise<Document | null> {
    const row = await clientOf(this.prisma, tx).document.findFirst({
      where: { applicationId, requirementId, status: 'VERIFIED' },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toDoc(row) : null;
  }
}
function toUpload(r: UploadRow): DocumentUpload {
  return {
    id: r.id,
    applicationId: r.applicationId,
    requirementId: r.requirementId,
    objectKey: r.objectKey,
    declaredContentType: r.declaredContentType,
    declaredSizeBytes: r.declaredSizeBytes,
    status: r.status as UploadStatus,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
  };
}
function toDoc(r: DocRow): Document {
  return {
    id: r.id,
    applicationId: r.applicationId,
    requirementId: r.requirementId,
    documentType: r.documentType,
    files: r.files as unknown as DocumentFile[],
    status: r.status as DocumentStatus,
    operationId: r.operationId,
    safeErrorCategory: r.safeErrorCategory ?? undefined,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

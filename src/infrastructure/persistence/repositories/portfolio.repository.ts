import { Injectable } from '@nestjs/common';
import type {
  PortfolioImport as ImportRow,
  PortfolioSnapshot as SnapshotRow,
} from '@prisma/client';
import type {
  PortfolioRepositoryPort,
  PortfolioSnapshot,
} from '../../../application/ports/portfolio.repository.port';
import { FieldCipher } from '../../../common/crypto/field-cipher';
import type { PortfolioSnapshotData } from '../../../domain/portfolio/cas-parser';
import type {
  PortfolioFailureCategory,
  PortfolioImport,
  PortfolioImportStatus,
} from '../../../domain/portfolio/portfolio-import';
import { PrismaService } from '../prisma.service';
import type { TransactionContext } from '../transaction-context';
import { clientOf } from './base.repository';

const bytes = (b: Buffer): Uint8Array<ArrayBuffer> => new Uint8Array(b);

@Injectable()
export class PortfolioRepository implements PortfolioRepositoryPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
  ) {}

  async createImport(
    imp: PortfolioImport,
    tx?: TransactionContext,
  ): Promise<void> {
    await clientOf(this.prisma, tx).portfolioImport.create({
      data: this.toRow(imp),
    });
  }
  async updateImport(
    imp: PortfolioImport,
    tx?: TransactionContext,
  ): Promise<void> {
    await clientOf(this.prisma, tx).portfolioImport.update({
      where: { id: imp.id },
      data: this.toRow(imp),
    });
  }
  async findImport(
    id: string,
    tx?: TransactionContext,
  ): Promise<PortfolioImport | null> {
    const r = await clientOf(this.prisma, tx).portfolioImport.findUnique({
      where: { id },
    });
    return r ? toDomain(r) : null;
  }
  async findImportByClientRef(
    clientRefNo: string,
    tx?: TransactionContext,
  ): Promise<PortfolioImport | null> {
    const r = await clientOf(this.prisma, tx).portfolioImport.findUnique({
      where: { clientRefNo },
    });
    return r ? toDomain(r) : null;
  }
  async latestImport(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<PortfolioImport | null> {
    const r = await clientOf(this.prisma, tx).portfolioImport.findFirst({
      where: { applicationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return r ? toDomain(r) : null;
  }
  async createSnapshot(
    s: PortfolioSnapshot,
    tx?: TransactionContext,
  ): Promise<boolean> {
    const r = await clientOf(this.prisma, tx).portfolioSnapshot.createMany({
      data: {
        id: s.id,
        importId: s.importId,
        applicationId: s.applicationId,
        asOf: s.data.asOf,
        data: bytes(this.cipher.encryptToBuffer(JSON.stringify(s.data))),
        evidenceKey: s.evidenceKey,
        createdAt: s.createdAt,
      },
      skipDuplicates: true,
    });
    return r.count === 1;
  }
  async latestSnapshot(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<PortfolioSnapshot | null> {
    const r = await clientOf(this.prisma, tx).portfolioSnapshot.findFirst({
      where: { applicationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return r ? this.snapshotToDomain(r) : null;
  }

  private toRow(imp: PortfolioImport) {
    return {
      id: imp.id,
      applicationId: imp.applicationId,
      provider: imp.provider,
      status: imp.status,
      clientRefNo: imp.clientRefNo,
      providerRequestId: imp.providerRequestId ?? null,
      authorisationUrl: imp.authorisationUrl ?? null,
      failureCategory: imp.failureCategory ?? null,
      expiresAt: imp.expiresAt,
      createdAt: imp.createdAt,
      updatedAt: imp.updatedAt,
      completedAt: imp.completedAt ?? null,
    };
  }
  private snapshotToDomain(r: SnapshotRow): PortfolioSnapshot {
    return {
      id: r.id,
      importId: r.importId,
      applicationId: r.applicationId,
      data: JSON.parse(
        this.cipher.decryptFromBuffer(Buffer.from(r.data)),
      ) as PortfolioSnapshotData,
      evidenceKey: r.evidenceKey,
      createdAt: r.createdAt,
    };
  }
}

function toDomain(r: ImportRow): PortfolioImport {
  return {
    id: r.id,
    applicationId: r.applicationId,
    provider: 'MFCENTRAL',
    status: r.status as PortfolioImportStatus,
    clientRefNo: r.clientRefNo,
    providerRequestId: r.providerRequestId ?? undefined,
    authorisationUrl: r.authorisationUrl ?? undefined,
    failureCategory: (r.failureCategory ?? undefined) as
      PortfolioFailureCategory | undefined,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    completedAt: r.completedAt ?? undefined,
  };
}

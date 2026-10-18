import { Injectable } from '@nestjs/common';
import type { Acknowledgement as AckRow, Prisma } from '@prisma/client';
import type {
  FeeIllustrationRecord,
  FeeRepositoryPort,
} from '../../../application/ports/fee.repository.port';
import { FieldCipher } from '../../../common/crypto/field-cipher';
import type { Acknowledgement } from '../../../domain/documents/document-pack';
import { PrismaService } from '../prisma.service';
import type { TransactionContext } from '../transaction-context';
import { clientOf } from './base.repository';

const bytes = (b: Buffer): Uint8Array<ArrayBuffer> => new Uint8Array(b);

@Injectable()
export class FeeRepository implements FeeRepositoryPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
  ) {}

  async createIllustration(
    r: FeeIllustrationRecord,
    tx?: TransactionContext,
  ): Promise<void> {
    await clientOf(this.prisma, tx).feeIllustration.create({
      data: {
        id: r.id,
        applicationId: r.applicationId,
        approachCode: r.approachCode,
        feeScheduleVersion: r.feeScheduleVersion,
        scenarioCode: r.scenarioCode,
        disclaimerVersion: r.disclaimerVersion,
        assumptions: r.assumptions,
        lineItems: r.lineItems as unknown as Prisma.InputJsonValue,
        createdAt: r.createdAt,
      },
    });
  }
  async appendAcknowledgement(
    a: Acknowledgement,
    tx?: TransactionContext,
  ): Promise<void> {
    await clientOf(this.prisma, tx).acknowledgement.create({
      data: {
        applicationId: a.applicationId,
        version: a.version,
        documentPackVersion: a.documentPackVersion,
        items: a.items,
        feeUnderstandingNote: bytes(
          this.cipher.encryptToBuffer(a.feeUnderstandingNote),
        ),
        feeAnnexureExecutionRequired: a.feeAnnexureExecutionRequired,
        recordedAt: a.recordedAt,
      },
    });
  }
  async latestAcknowledgement(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<Acknowledgement | null> {
    const r = await clientOf(this.prisma, tx).acknowledgement.findFirst({
      where: { applicationId },
      orderBy: { version: 'desc' },
    });
    return r ? this.toDomain(r) : null;
  }
  private toDomain(r: AckRow): Acknowledgement {
    return {
      applicationId: r.applicationId,
      version: r.version,
      documentPackVersion: r.documentPackVersion,
      items: r.items as Acknowledgement['items'],
      feeUnderstandingNote: this.cipher.decryptFromBuffer(
        Buffer.from(r.feeUnderstandingNote),
      ),
      feeAnnexureExecutionRequired: r.feeAnnexureExecutionRequired,
      recordedAt: r.recordedAt,
    };
  }
}

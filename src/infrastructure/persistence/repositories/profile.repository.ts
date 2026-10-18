import { Injectable } from '@nestjs/common';
import type {
  CustomerProfile as ProfileRow,
  Declaration as DeclRow,
} from '@prisma/client';
import type {
  DeclarationsRepositoryPort,
  ProfileRepositoryPort,
} from '../../../application/ports/profile.repository.port';
import { FieldCipher } from '../../../common/crypto/field-cipher';
import type {
  Declarations,
  TaxResidencyInput,
} from '../../../domain/profile/declarations';
import type { CustomerProfile } from '../../../domain/profile/profile';
import { PrismaService } from '../prisma.service';
import type { TransactionContext } from '../transaction-context';
import { clientOf } from './base.repository';

const bytes = (b: Buffer): Uint8Array<ArrayBuffer> => new Uint8Array(b);

@Injectable()
export class ProfileRepository implements ProfileRepositoryPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
  ) {}

  async append(p: CustomerProfile, tx?: TransactionContext): Promise<void> {
    await clientOf(this.prisma, tx).customerProfile.create({
      data: {
        applicationId: p.applicationId,
        version: p.version,
        occupation: p.occupation,
        annualIncomeBand: p.annualIncomeBand,
        sourceOfFunds: p.sourceOfFunds,
        sourceOfFundsExplanation: p.sourceOfFundsExplanation
          ? bytes(this.cipher.encryptToBuffer(p.sourceOfFundsExplanation))
          : null,
        evidenceRequired: p.evidenceRequired,
        savedAt: p.savedAt,
      },
    });
  }
  async latest(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<CustomerProfile | null> {
    const r = await clientOf(this.prisma, tx).customerProfile.findFirst({
      where: { applicationId },
      orderBy: { version: 'desc' },
    });
    return r ? this.toDomain(r) : null;
  }
  private toDomain(r: ProfileRow): CustomerProfile {
    return {
      applicationId: r.applicationId,
      version: r.version,
      occupation: r.occupation,
      annualIncomeBand: r.annualIncomeBand,
      sourceOfFunds: r.sourceOfFunds as string[],
      sourceOfFundsExplanation: r.sourceOfFundsExplanation
        ? this.cipher.decryptFromBuffer(Buffer.from(r.sourceOfFundsExplanation))
        : undefined,
      evidenceRequired: r.evidenceRequired,
      savedAt: r.savedAt,
    };
  }
}

@Injectable()
export class DeclarationsRepository implements DeclarationsRepositoryPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
  ) {}

  async append(d: Declarations, tx?: TransactionContext): Promise<void> {
    await clientOf(this.prisma, tx).declaration.create({
      data: {
        applicationId: d.applicationId,
        version: d.version,
        taxResidencies: bytes(
          this.cipher.encryptToBuffer(JSON.stringify(d.taxResidencies)),
        ),
        pepDeclaration: d.pepDeclaration,
        declarationVersion: d.declarationVersion,
        additionalInformationRequired: d.additionalInformationRequired,
        attestedAt: d.attestedAt,
      },
    });
  }
  async latest(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<Declarations | null> {
    const r = await clientOf(this.prisma, tx).declaration.findFirst({
      where: { applicationId },
      orderBy: { version: 'desc' },
    });
    return r ? this.toDomain(r) : null;
  }
  private toDomain(r: DeclRow): Declarations {
    return {
      applicationId: r.applicationId,
      version: r.version,
      taxResidencies: JSON.parse(
        this.cipher.decryptFromBuffer(Buffer.from(r.taxResidencies)),
      ) as TaxResidencyInput[],
      pepDeclaration: r.pepDeclaration,
      declarationVersion: r.declarationVersion,
      additionalInformationRequired: r.additionalInformationRequired,
      attestedAt: r.attestedAt,
    };
  }
}

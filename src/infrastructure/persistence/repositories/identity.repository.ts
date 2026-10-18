import { Injectable } from '@nestjs/common';
import type { IdentityVersion as Row } from '@prisma/client';
import type { IdentityRepositoryPort } from '../../../application/ports/identity.repository.port';
import { FieldCipher } from '../../../common/crypto/field-cipher';
import { Fingerprint } from '../../../common/crypto/fingerprint';
import type {
  IdentityStatus,
  IdentityVersion,
} from '../../../domain/kyc/identity-version';
import type { IsoDate } from '../../../domain/shared/iso-date';
import { PrismaService } from '../prisma.service';
import type { TransactionContext } from '../transaction-context';
import { clientOf } from './base.repository';

@Injectable()
export class IdentityRepository implements IdentityRepositoryPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
    private readonly fingerprint: Fingerprint,
  ) {}

  async append(i: IdentityVersion, tx?: TransactionContext): Promise<void> {
    await clientOf(this.prisma, tx).identityVersion.create({
      data: {
        applicationId: i.applicationId,
        version: i.version,
        panCiphertext: new Uint8Array(this.cipher.encryptToBuffer(i.pan)),
        panFingerprint: this.fingerprint.of(i.pan, 'pan'),
        legalName: i.legalName,
        dateOfBirth: new Date(`${i.dateOfBirth}T00:00:00Z`),
        permissionVersion: i.permissionVersion,
        status: i.status,
        submittedAt: i.submittedAt,
      },
    });
  }

  async latest(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<IdentityVersion | null> {
    const row = await clientOf(this.prisma, tx).identityVersion.findFirst({
      where: { applicationId },
      orderBy: { version: 'desc' },
    });
    return row ? this.toDomain(row) : null;
  }

  async otherApplicationsWithPan(
    panFingerprint: string,
    exceptApplicationId: string,
    tx?: TransactionContext,
  ): Promise<string[]> {
    const rows = await clientOf(this.prisma, tx).identityVersion.findMany({
      where: { panFingerprint, applicationId: { not: exceptApplicationId } },
      select: { applicationId: true },
      distinct: ['applicationId'],
    });
    return rows.map((r) => r.applicationId);
  }

  private toDomain(r: Row): IdentityVersion {
    return {
      applicationId: r.applicationId,
      version: r.version,
      pan: this.cipher.decryptFromBuffer(Buffer.from(r.panCiphertext)),
      legalName: r.legalName,
      dateOfBirth: r.dateOfBirth.toISOString().slice(0, 10) as IsoDate,
      permissionVersion: r.permissionVersion,
      status: r.status as IdentityStatus,
      submittedAt: r.submittedAt,
    };
  }
}

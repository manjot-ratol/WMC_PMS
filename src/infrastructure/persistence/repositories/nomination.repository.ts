import { Injectable } from '@nestjs/common';
import type { Nomination as Row } from '@prisma/client';
import type { NominationRepositoryPort } from '../../../application/ports/nomination.repository.port';
import { FieldCipher } from '../../../common/crypto/field-cipher';
import type {
  Nomination,
  NomineeInput,
} from '../../../domain/nomination/nomination';
import { PrismaService } from '../prisma.service';
import type { TransactionContext } from '../transaction-context';
import { clientOf } from './base.repository';

@Injectable()
export class NominationRepository implements NominationRepositoryPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
  ) {}

  async append(n: Nomination, tx?: TransactionContext): Promise<void> {
    await clientOf(this.prisma, tx).nomination.create({
      data: {
        applicationId: n.applicationId,
        version: n.version,
        choice: n.choice,
        allocationMode: n.allocationMode ?? null,
        nomineesCiphertext: new Uint8Array(
          this.cipher.encryptToBuffer(JSON.stringify(n.nominees)),
        ),
        nomineeCount: n.nominees.length,
        registrationStatus: n.registrationStatus,
        savedAt: n.savedAt,
      },
    });
  }
  async latest(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<Nomination | null> {
    const r = await clientOf(this.prisma, tx).nomination.findFirst({
      where: { applicationId },
      orderBy: { version: 'desc' },
    });
    return r ? this.toDomain(r) : null;
  }
  private toDomain(r: Row): Nomination {
    return {
      applicationId: r.applicationId,
      version: r.version,
      choice: r.choice as Nomination['choice'],
      allocationMode: (r.allocationMode ??
        undefined) as Nomination['allocationMode'],
      nominees: JSON.parse(
        this.cipher.decryptFromBuffer(Buffer.from(r.nomineesCiphertext)),
      ) as NomineeInput[],
      registrationStatus:
        r.registrationStatus as Nomination['registrationStatus'],
      savedAt: r.savedAt,
    };
  }
}

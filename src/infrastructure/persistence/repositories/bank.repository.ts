import { Injectable } from '@nestjs/common';
import type {
  BankAccount as AccountRow,
  BankVerification as VerificationRow,
} from '@prisma/client';
import type { BankRepositoryPort } from '../../../application/ports/bank.repository.port';
import { FieldCipher } from '../../../common/crypto/field-cipher';
import { Fingerprint } from '../../../common/crypto/fingerprint';
import type {
  BankAccount,
  BankVerification,
  BankVerificationStatus,
  RequiredAction,
} from '../../../domain/bank/bank-account';
import { PrismaService } from '../prisma.service';
import type { TransactionContext } from '../transaction-context';
import { clientOf } from './base.repository';

@Injectable()
export class BankRepository implements BankRepositoryPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
    private readonly fingerprint: Fingerprint,
  ) {}

  async createAccount(a: BankAccount, tx?: TransactionContext): Promise<void> {
    await clientOf(this.prisma, tx).bankAccount.create({
      data: {
        id: a.id,
        applicationId: a.applicationId,
        accountCiphertext: new Uint8Array(
          this.cipher.encryptToBuffer(a.accountNumber),
        ),
        accountFingerprint: this.fingerprint.of(a.accountNumber, 'account'),
        ifsc: a.ifsc,
        holderName: a.holderName,
        version: a.version,
        createdAt: a.createdAt,
      },
    });
  }
  async findAccount(
    id: string,
    tx?: TransactionContext,
  ): Promise<BankAccount | null> {
    const r = await clientOf(this.prisma, tx).bankAccount.findUnique({
      where: { id },
    });
    return r ? this.toAccount(r) : null;
  }
  async findAccountByFingerprint(
    applicationId: string,
    accountFingerprint: string,
    tx?: TransactionContext,
  ): Promise<BankAccount | null> {
    const r = await clientOf(this.prisma, tx).bankAccount.findFirst({
      where: { applicationId, accountFingerprint },
      orderBy: { version: 'desc' },
    });
    return r ? this.toAccount(r) : null;
  }
  async createVerification(
    v: BankVerification,
    tx?: TransactionContext,
  ): Promise<void> {
    await clientOf(this.prisma, tx).bankVerification.create({
      data: {
        id: v.id,
        applicationId: v.applicationId,
        bankAccountId: v.bankAccountId,
        createdAt: v.createdAt,
        ...cols(v),
      },
    });
  }
  async findVerification(
    id: string,
    tx?: TransactionContext,
  ): Promise<BankVerification | null> {
    const r = await clientOf(this.prisma, tx).bankVerification.findUnique({
      where: { id },
    });
    return r ? toVerification(r) : null;
  }
  async latestVerification(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<BankVerification | null> {
    const r = await clientOf(this.prisma, tx).bankVerification.findFirst({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
    });
    return r ? toVerification(r) : null;
  }
  async updateVerification(
    v: BankVerification,
    tx?: TransactionContext,
  ): Promise<void> {
    await clientOf(this.prisma, tx).bankVerification.update({
      where: { id: v.id },
      data: cols(v),
    });
  }
  countVerifications(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<number> {
    return clientOf(this.prisma, tx).bankVerification.count({
      where: { applicationId },
    });
  }
  private toAccount(r: AccountRow): BankAccount {
    return {
      id: r.id,
      applicationId: r.applicationId,
      accountNumber: this.cipher.decryptFromBuffer(
        Buffer.from(r.accountCiphertext),
      ),
      ifsc: r.ifsc,
      holderName: r.holderName,
      version: r.version,
      createdAt: r.createdAt,
    };
  }
}
function cols(v: BankVerification) {
  return {
    status: v.status,
    requiredActions: v.requiredActions,
    providerReference: v.providerReference ?? null,
    evidenceKey: v.evidenceKey ?? null,
    safeErrorCategory: v.safeErrorCategory ?? null,
  };
}
function toVerification(r: VerificationRow): BankVerification {
  return {
    id: r.id,
    applicationId: r.applicationId,
    bankAccountId: r.bankAccountId,
    status: r.status as BankVerificationStatus,
    requiredActions: r.requiredActions as RequiredAction[],
    providerReference: r.providerReference ?? undefined,
    evidenceKey: r.evidenceKey ?? undefined,
    safeErrorCategory: r.safeErrorCategory ?? undefined,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

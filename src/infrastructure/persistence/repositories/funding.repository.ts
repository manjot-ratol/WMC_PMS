import { Injectable } from '@nestjs/common';
import type {
  FundingNotification as NotRow,
  FundingReceipt as RecRow,
} from '@prisma/client';
import type { FundingRepositoryPort } from '../../../application/ports/funding.repository.port';
import { FieldCipher } from '../../../common/crypto/field-cipher';
import type {
  FundingNotification,
  FundingReceipt,
  MatchStatus,
} from '../../../domain/funding/funding';
import { PrismaService } from '../prisma.service';
import type { TransactionContext } from '../transaction-context';
import { clientOf } from './base.repository';

@Injectable()
export class FundingRepository implements FundingRepositoryPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
  ) {}

  async createNotification(
    n: FundingNotification,
    tx?: TransactionContext,
  ): Promise<void> {
    await clientOf(this.prisma, tx).fundingNotification.create({
      data: {
        id: n.id,
        applicationId: n.applicationId,
        fundingMethod: n.fundingMethod,
        customerTransferReference: new Uint8Array(
          this.cipher.encryptToBuffer(n.customerTransferReference),
        ),
        createdAt: n.createdAt,
      },
    });
  }
  async latestNotification(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<FundingNotification | null> {
    const r = await clientOf(this.prisma, tx).fundingNotification.findFirst({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
    });
    return r ? this.toNotification(r) : null;
  }
  /** ON CONFLICT DO NOTHING keeps the surrounding transaction usable when the key was already seen. */
  async insertReceiptIfNew(
    r: FundingReceipt,
    tx?: TransactionContext,
  ): Promise<{ inserted: boolean; receipt: FundingReceipt }> {
    const client = clientOf(this.prisma, tx);
    const res = await client.fundingReceipt.createMany({
      data: {
        id: r.id,
        applicationId: r.applicationId,
        providerReceiptKey: r.providerReceiptKey,
        provider: r.provider,
        amountInr: BigInt(r.amountInr),
        currency: r.currency,
        sourceAccountFingerprint: r.sourceAccountFingerprint ?? null,
        destinationReference: r.destinationReference,
        valueDate: r.valueDate,
        matchStatus: r.matchStatus,
        mismatchReasons: r.mismatchReasons,
        receivedAt: r.receivedAt,
      },
      skipDuplicates: true,
    });
    const row = await client.fundingReceipt.findUniqueOrThrow({
      where: { providerReceiptKey: r.providerReceiptKey },
    });
    return { inserted: res.count === 1, receipt: toReceipt(row) };
  }
  async listReceipts(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<FundingReceipt[]> {
    const rows = await clientOf(this.prisma, tx).fundingReceipt.findMany({
      where: { applicationId },
      orderBy: { receivedAt: 'asc' },
    });
    return rows.map(toReceipt);
  }
  async sumMatched(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<number> {
    const agg = await clientOf(this.prisma, tx).fundingReceipt.aggregate({
      where: { applicationId, matchStatus: 'MATCHED' },
      _sum: { amountInr: true },
    });
    return Number(agg._sum.amountInr ?? 0n);
  }
  private toNotification(r: NotRow): FundingNotification {
    return {
      id: r.id,
      applicationId: r.applicationId,
      fundingMethod: r.fundingMethod,
      customerTransferReference: this.cipher.decryptFromBuffer(
        Buffer.from(r.customerTransferReference),
      ),
      createdAt: r.createdAt,
    };
  }
}

const toReceipt = (r: RecRow): FundingReceipt => ({
  id: r.id,
  applicationId: r.applicationId,
  providerReceiptKey: r.providerReceiptKey,
  provider: r.provider,
  amountInr: Number(r.amountInr),
  currency: r.currency,
  sourceAccountFingerprint: r.sourceAccountFingerprint ?? undefined,
  destinationReference: r.destinationReference,
  valueDate: r.valueDate,
  matchStatus: r.matchStatus as MatchStatus,
  mismatchReasons: r.mismatchReasons as string[],
  receivedAt: r.receivedAt,
});

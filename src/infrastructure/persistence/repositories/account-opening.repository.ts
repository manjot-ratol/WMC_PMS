import { Injectable } from '@nestjs/common';
import type {
  AccountOpeningRun as RunRow,
  RegistrySubmission as SubRow,
  UnderlyingAccount as AccRow,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { AccountOpeningRepositoryPort } from '../../../application/ports/account-opening.repository.port';
import type {
  AccountOpeningRun,
  AccountOpeningRunStatus,
  Registry,
  RegistrySubmission,
  RegistrySubmissionStatus,
  UnderlyingAccount,
  UnderlyingAccountStatus,
} from '../../../domain/account-opening/account-opening';
import { PrismaService } from '../prisma.service';
import type { TransactionContext } from '../transaction-context';
import { clientOf } from './base.repository';

@Injectable()
export class AccountOpeningRepository implements AccountOpeningRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async createRun(
    run: AccountOpeningRun,
    tx?: TransactionContext,
  ): Promise<void> {
    await clientOf(this.prisma, tx).accountOpeningRun.create({
      data: {
        id: run.id,
        applicationId: run.applicationId,
        snapshotId: run.snapshotId,
        documentPackVersion: run.documentPackVersion,
        status: run.status,
        blockers: run.blockers,
        createdAt: run.createdAt,
        completedAt: run.completedAt ?? null,
      },
    });
  }
  async findRun(
    id: string,
    tx?: TransactionContext,
  ): Promise<AccountOpeningRun | null> {
    const r = await clientOf(this.prisma, tx).accountOpeningRun.findUnique({
      where: { id },
    });
    return r ? toRun(r) : null;
  }
  async latestRun(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<AccountOpeningRun | null> {
    const r = await clientOf(this.prisma, tx).accountOpeningRun.findFirst({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
    });
    return r ? toRun(r) : null;
  }
  async updateRun(
    run: AccountOpeningRun,
    tx?: TransactionContext,
  ): Promise<void> {
    await clientOf(this.prisma, tx).accountOpeningRun.update({
      where: { id: run.id },
      data: {
        status: run.status,
        blockers: run.blockers,
        completedAt: run.completedAt ?? null,
      },
    });
  }
  async createSubmission(
    s: RegistrySubmission,
    tx?: TransactionContext,
  ): Promise<void> {
    await clientOf(this.prisma, tx).registrySubmission.create({
      data: toSubRow(s),
    });
  }
  async findSubmissionByReference(
    ref: { providerRequestId?: string; clientReferenceId?: string },
    tx?: TransactionContext,
  ): Promise<RegistrySubmission | null> {
    const or: Prisma.RegistrySubmissionWhereInput[] = [];
    if (ref.providerRequestId)
      or.push({ providerRequestId: ref.providerRequestId });
    if (ref.clientReferenceId)
      or.push({ clientReferenceId: ref.clientReferenceId });
    if (!or.length) return null;
    const r = await clientOf(this.prisma, tx).registrySubmission.findFirst({
      where: { OR: or },
      orderBy: { createdAt: 'desc' },
    });
    return r ? toSub(r) : null;
  }
  async listSubmissions(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<RegistrySubmission[]> {
    const rows = await clientOf(this.prisma, tx).registrySubmission.findMany({
      where: { applicationId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toSub);
  }
  async updateSubmission(
    s: RegistrySubmission,
    tx?: TransactionContext,
  ): Promise<void> {
    const { id, ...data } = toSubRow(s);
    await clientOf(this.prisma, tx).registrySubmission.update({
      where: { id },
      data,
    });
  }
  /** ON CONFLICT DO NOTHING keeps the surrounding transaction usable when the key was already seen. */
  async insertUnderlyingAccountIfNew(
    a: UnderlyingAccount,
    tx?: TransactionContext,
  ): Promise<{ inserted: boolean; account: UnderlyingAccount }> {
    const client = clientOf(this.prisma, tx);
    const r = await client.underlyingAccount.createMany({
      data: { ...a },
      skipDuplicates: true,
    });
    const row = await client.underlyingAccount.findUniqueOrThrow({
      where: { providerReceiptKey: a.providerReceiptKey },
    });
    return { inserted: r.count === 1, account: toAcc(row) };
  }
  async listUnderlyingAccounts(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<UnderlyingAccount[]> {
    const rows = await clientOf(this.prisma, tx).underlyingAccount.findMany({
      where: { applicationId },
      orderBy: { receivedAt: 'asc' },
    });
    return rows.map(toAcc);
  }
}

const toRun = (r: RunRow): AccountOpeningRun => ({
  id: r.id,
  applicationId: r.applicationId,
  snapshotId: r.snapshotId,
  documentPackVersion: r.documentPackVersion,
  status: r.status as AccountOpeningRunStatus,
  blockers: r.blockers as string[],
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  completedAt: r.completedAt ?? undefined,
});
const toSubRow = (s: RegistrySubmission) => ({
  id: s.id,
  applicationId: s.applicationId,
  runId: s.runId,
  registry: s.registry,
  status: s.status,
  basis: s.basis ?? null,
  providerRequestId: s.providerRequestId ?? null,
  clientReferenceId: s.clientReferenceId ?? null,
  lastProviderStatus: s.lastProviderStatus ?? null,
  deadlineAt: s.deadlineAt ?? null,
  evidenceKey: s.evidenceKey ?? null,
  safeErrorCategory: s.safeErrorCategory ?? null,
  createdAt: s.createdAt,
});
const toSub = (r: SubRow): RegistrySubmission => ({
  id: r.id,
  applicationId: r.applicationId,
  runId: r.runId,
  registry: r.registry as Registry,
  status: r.status as RegistrySubmissionStatus,
  basis: r.basis ?? undefined,
  providerRequestId: r.providerRequestId ?? undefined,
  clientReferenceId: r.clientReferenceId ?? undefined,
  lastProviderStatus: r.lastProviderStatus ?? undefined,
  deadlineAt: r.deadlineAt ?? undefined,
  evidenceKey: r.evidenceKey ?? undefined,
  safeErrorCategory: r.safeErrorCategory ?? undefined,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});
const toAcc = (r: AccRow): UnderlyingAccount => ({
  id: r.id,
  applicationId: r.applicationId,
  providerReceiptKey: r.providerReceiptKey,
  provider: r.provider,
  accountType: r.accountType,
  accountReference: r.accountReference,
  status: r.status as UnderlyingAccountStatus,
  receivedAt: r.receivedAt,
});

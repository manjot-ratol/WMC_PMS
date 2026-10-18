import { Inject, Injectable } from '@nestjs/common';
import { Fingerprint } from '../../common/crypto/fingerprint';
import { NotFoundError, ValidationError } from '../../common/errors/app-error';
import {
  BANK_RULEBOOK,
  bankNextScreen,
  maskAccount,
  normaliseAccountNumber,
  normaliseIfsc,
  type BankAccount,
  type BankRulebook,
  type BankVerification,
} from '../../domain/bank/bank-account';
import { requireStep } from '../../domain/onboarding/application';
import { ID_PREFIX } from '../../domain/shared/public-id';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepositoryPort,
} from '../ports/application.repository.port';
import { AUDIT, type AuditPort } from '../ports/audit.port';
import {
  BANK_REPOSITORY,
  type BankRepositoryPort,
} from '../ports/bank.repository.port';
import { CLOCK, type ClockPort } from '../ports/clock.port';
import { ID_GENERATOR, type IdGeneratorPort } from '../ports/id-generator.port';
import { OUTBOX, type OutboxPort } from '../ports/outbox.port';
import { UNIT_OF_WORK, type UnitOfWork } from '../ports/unit-of-work.port';

export interface StartBankVerificationCommand {
  applicationId: string;
  customerId: string;
  accountNumber: string;
  accountNumberConfirmation: string;
  ifsc: string;
  holderName: string;
}
export interface BankVerificationView {
  status: BankVerification['status'];
  accountMasked: string;
  requiredActions: string[];
  nextScreen: string;
}
export const SCREEN_BANK = '14';

/** Screens 14–15: start a server-side ownership check (worker job) and read its durable outcome. */
@Injectable()
export class BankVerificationService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
    @Inject(BANK_REPOSITORY) private readonly bank: BankRepositoryPort,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    @Inject(BANK_RULEBOOK) private readonly rulebook: BankRulebook,
    private readonly fingerprint: Fingerprint,
  ) {}

  async start(cmd: StartBankVerificationCommand): Promise<{
    verificationId: string;
    status: 'PROCESSING';
    nextScreen: 'BANK_PROGRESS';
  }> {
    const accountNumber = normaliseAccountNumber(cmd.accountNumber);
    if (normaliseAccountNumber(cmd.accountNumberConfirmation) !== accountNumber)
      throw new ValidationError('Account numbers do not match', {
        details: { field: 'account_number_confirmation' },
      });
    const ifsc = normaliseIfsc(cmd.ifsc);
    const holderName = (cmd.holderName ?? '').trim();
    if (holderName.length < 2 || holderName.length > 100)
      throw new ValidationError(undefined, {
        details: { field: 'holder_name' },
      });
    const now = this.clock.now();

    return this.uow.run(async (tx) => {
      const app = await this.applications.findById(cmd.applicationId, tx);
      if (!app || app.customerId !== cmd.customerId) throw new NotFoundError();
      requireStep(app, 'DECLARATIONS');
      const fp = this.fingerprint.of(accountNumber, 'account');
      const existingAccount = await this.bank.findAccountByFingerprint(
        app.id,
        fp,
        tx,
      );
      const latest = await this.bank.latestVerification(app.id, tx);
      if (
        existingAccount &&
        latest &&
        latest.bankAccountId === existingAccount.id &&
        latest.status === 'PROCESSING'
      ) {
        return {
          verificationId: latest.id,
          status: 'PROCESSING' as const,
          nextScreen: 'BANK_PROGRESS' as const,
        }; // no second chargeable check
      }
      const attempts = await this.bank.countVerifications(app.id, tx);
      if (attempts >= this.rulebook.maxAttempts)
        throw new ValidationError(undefined, {
          details: {
            reason: 'max_attempts',
            nextScreen: 'ASSISTED_ONBOARDING',
          },
        });

      let account: BankAccount | null =
        existingAccount && existingAccount.ifsc === ifsc
          ? existingAccount
          : null;
      if (!account) {
        account = {
          id: this.ids.prefixed(ID_PREFIX.bankAccount),
          applicationId: app.id,
          accountNumber,
          ifsc,
          holderName,
          version: (existingAccount?.version ?? 0) + 1,
          createdAt: now,
        };
        await this.bank.createAccount(account, tx);
      }
      const verification: BankVerification = {
        id: this.ids.prefixed(ID_PREFIX.bankVerification),
        applicationId: app.id,
        bankAccountId: account.id,
        status: 'PROCESSING',
        requiredActions: [],
        createdAt: now,
        updatedAt: now,
      };
      await this.bank.createVerification(verification, tx);
      await this.applications.saveWithVersionCheck(
        { ...app, nextScreen: 'BANK_PROGRESS', version: app.version + 1 },
        app.version,
        tx,
      );
      await this.audit.append(
        {
          actorType: 'CUSTOMER',
          actorId: cmd.customerId,
          action: 'bank_verification.started',
          aggregateType: 'application',
          aggregateId: app.id,
          details: {
            verificationId: verification.id,
            bankAccountId: account.id,
            ifsc,
          },
        },
        tx,
      );
      await this.outbox.add(
        {
          aggregateType: 'application',
          aggregateId: app.id,
          eventType: 'BankVerificationRequested',
          payload: { verificationId: verification.id },
        },
        tx,
      );
      return {
        verificationId: verification.id,
        status: 'PROCESSING',
        nextScreen: 'BANK_PROGRESS',
      };
    });
  }

  async get(
    applicationId: string,
    customerId: string,
    verificationId: string,
  ): Promise<BankVerificationView> {
    const app = await this.applications.findById(applicationId);
    if (!app || app.customerId !== customerId) throw new NotFoundError();
    const v = await this.bank.findVerification(verificationId);
    if (!v || v.applicationId !== applicationId) throw new NotFoundError();
    const account = await this.bank.findAccount(v.bankAccountId);
    return {
      status: v.status,
      accountMasked: account ? maskAccount(account.accountNumber) : '••••',
      requiredActions: v.requiredActions,
      nextScreen: bankNextScreen(v.status),
    };
  }
}

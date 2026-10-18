import { Inject, Injectable } from '@nestjs/common';
import { fundingConfig } from '../../common/config/funding.config';
import { Fingerprint } from '../../common/crypto/fingerprint';
import { NotFoundError, ValidationError } from '../../common/errors/app-error';
import {
  accountsReady,
  ACCOUNT_OPENING_RULEBOOK,
  type AccountOpeningRulebook,
} from '../../domain/account-opening/account-opening';
import {
  activationStatusFor,
  evaluateActivationGates,
  ACTIVATION_RULEBOOK,
  type ActivationRulebook,
  type ActivationStatus,
} from '../../domain/activation/activation';
import { maskAccount } from '../../domain/bank/bank-account';
import {
  FUNDING_RULEBOOK,
  fundingStatusFor,
  paymentReference,
  reconcileReceipt,
  validateFundingMethod,
  type FundingRulebook,
  type FundingStatus,
} from '../../domain/funding/funding';
import type { OnboardingApplication } from '../../domain/onboarding/application';
import type { Screen } from '../../domain/onboarding/screens';
import { ID_PREFIX } from '../../domain/shared/public-id';
import { needsCustomerAction } from '../../domain/tasks/task-visibility';
import {
  ACCOUNT_OPENING_REPOSITORY,
  type AccountOpeningRepositoryPort,
} from '../ports/account-opening.repository.port';
import {
  ACTIVATION_REPOSITORY,
  type ActivationRepositoryPort,
} from '../ports/activation.repository.port';
import { ANALYTICS, type AnalyticsPort } from '../ports/analytics.port';
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
import {
  COMPLIANCE_REPOSITORY,
  type ComplianceRepositoryPort,
} from '../ports/compliance.repository.port';
import {
  ELIGIBILITY_REPOSITORY,
  type EligibilityRepositoryPort,
} from '../ports/eligibility.repository.port';
import {
  FUNDING_REPOSITORY,
  type FundingRepositoryPort,
} from '../ports/funding.repository.port';
import { ID_GENERATOR, type IdGeneratorPort } from '../ports/id-generator.port';
import { OUTBOX, type OutboxPort } from '../ports/outbox.port';
import {
  SIGNING_REPOSITORY,
  type SigningRepositoryPort,
} from '../ports/signing.repository.port';
import {
  UNIT_OF_WORK,
  type TransactionContext,
  type UnitOfWork,
} from '../ports/unit-of-work.port';
import {
  TASK_REPOSITORY,
  type TaskRepositoryPort,
} from '../ports/verification.repository.port';

export interface FundingInstructionsView {
  status: 'READY';
  instructionsVersion: number;
  beneficiaryDetails: {
    accountName: string;
    accountNumberMasked: string;
    ifsc: string;
    bankName: string;
  };
  paymentReference: string;
  requiredAmountInr: number;
}
export interface FundingStatusView {
  fundingStatus: FundingStatus;
  activationStatus: ActivationStatus;
  customerActionRequired: boolean;
  nextScreen: Screen;
}
export interface ReceiptFeed {
  applicationId: string;
  providerReceiptKey: string;
  provider: string;
  amountInr: number;
  currency: string;
  sourceAccountNumber?: string;
  destinationReference: string;
  valueDate: string;
}
export interface GateEvaluation {
  ready: boolean;
  blockers: string[];
  fundingStatus: FundingStatus;
  pmsAccountReference?: string;
}
export const SCREEN_FUNDING = '23';
export const SCREEN_FUNDING_STATUS = '24';
export const SCREEN_COMPLETE = '25';
export const INSTRUCTIONS_VERSION = 1;

/** Screens 23–25 and the receipt feed. Receipts are evidence; notifications are hints; activation is a job. */
@Injectable()
export class FundingService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
    @Inject(ELIGIBILITY_REPOSITORY)
    private readonly eligibility: EligibilityRepositoryPort,
    @Inject(BANK_REPOSITORY) private readonly bank: BankRepositoryPort,
    @Inject(SIGNING_REPOSITORY) private readonly signing: SigningRepositoryPort,
    @Inject(ACCOUNT_OPENING_REPOSITORY)
    private readonly accounts: AccountOpeningRepositoryPort,
    @Inject(FUNDING_REPOSITORY) private readonly funding: FundingRepositoryPort,
    @Inject(COMPLIANCE_REPOSITORY)
    private readonly compliance: ComplianceRepositoryPort,
    @Inject(ACTIVATION_REPOSITORY)
    private readonly activations: ActivationRepositoryPort,
    @Inject(TASK_REPOSITORY) private readonly tasks: TaskRepositoryPort,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
    @Inject(ANALYTICS) private readonly analytics: AnalyticsPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    @Inject(FUNDING_RULEBOOK) private readonly rulebook: FundingRulebook,
    @Inject(ACCOUNT_OPENING_RULEBOOK)
    private readonly accountRulebook: AccountOpeningRulebook,
    @Inject(ACTIVATION_RULEBOOK)
    private readonly activationRulebook: ActivationRulebook,
    @Inject(fundingConfig.KEY)
    private readonly config: ReturnType<typeof fundingConfig>,
    private readonly fingerprint: Fingerprint,
  ) {}

  async instructions(
    applicationId: string,
    customerId: string,
  ): Promise<FundingInstructionsView> {
    const app = await this.owned(applicationId, customerId);
    await this.assertFundingReleased(app);
    const required = await this.requiredAmount(app.id);
    return {
      status: 'READY',
      instructionsVersion: INSTRUCTIONS_VERSION,
      beneficiaryDetails: {
        accountName: this.config.beneficiaryName,
        accountNumberMasked: maskAccount(this.config.beneficiaryAccountNumber),
        ifsc: this.config.beneficiaryIfsc,
        bankName: this.config.beneficiaryBankName,
      },
      paymentReference: paymentReference(app.id, this.rulebook.referencePrefix),
      requiredAmountInr: required,
    };
  }

  async notify(cmd: {
    applicationId: string;
    customerId: string;
    fundingMethod: string;
    customerTransferReference: string;
  }): Promise<{
    status: 'AWAITING_RECONCILIATION';
    notificationId: string;
    nextScreen: 'FUNDING_STATUS';
  }> {
    validateFundingMethod(cmd.fundingMethod, this.rulebook);
    const ref = cmd.customerTransferReference.trim();
    if (ref.length < 4 || ref.length > 64)
      throw new ValidationError(undefined, {
        details: { field: 'customer_transfer_reference' },
      });
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const app = await this.owned(cmd.applicationId, cmd.customerId, tx);
      await this.assertFundingReleased(app, tx);
      const id = this.ids.prefixed(ID_PREFIX.fundingNotification);
      await this.funding.createNotification(
        {
          id,
          applicationId: app.id,
          fundingMethod: cmd.fundingMethod,
          customerTransferReference: ref,
          createdAt: now,
        },
        tx,
      );
      if (app.nextScreen !== 'FUNDING_STATUS' && app.status === 'SUBMITTED')
        await this.applications.saveWithVersionCheck(
          { ...app, nextScreen: 'FUNDING_STATUS', version: app.version + 1 },
          app.version,
          tx,
        );
      await this.audit.append(
        {
          actorType: 'CUSTOMER',
          actorId: cmd.customerId,
          action: 'funding.notified',
          aggregateType: 'application',
          aggregateId: app.id,
          details: { notificationId: id, fundingMethod: cmd.fundingMethod },
        },
        tx,
      );
      return {
        status: 'AWAITING_RECONCILIATION',
        notificationId: id,
        nextScreen: 'FUNDING_STATUS',
      };
    });
  }

  async status(
    applicationId: string,
    customerId: string,
  ): Promise<FundingStatusView> {
    const app = await this.owned(applicationId, customerId);
    const gates = await this.evaluateGates(app);
    const activationStatus = activationStatusFor(app, gates);
    const open = await this.tasks.listOpen(app.id);
    const nextScreen: Screen =
      app.status === 'ACTIVE'
        ? 'PORTFOLIO'
        : gates.fundingStatus === 'RECONCILED'
          ? 'ACTIVATION_PROGRESS'
          : 'FUNDING_STATUS';
    return {
      fundingStatus: gates.fundingStatus,
      activationStatus,
      customerActionRequired: open.some(
        (t) => t.status === 'OPEN' && needsCustomerAction(t.category),
      ),
      nextScreen,
    };
  }

  async completion(
    applicationId: string,
    customerId: string,
  ): Promise<{
    applicationStatus: 'ACTIVE';
    pmsAccountId: string;
    onboardingComplete: true;
    firstInvestmentStatus: 'NOT_STARTED';
    nextScreen: 'PORTFOLIO';
  }> {
    const app = await this.owned(applicationId, customerId);
    const activation = await this.activations.findByApplication(app.id);
    if (app.status !== 'ACTIVE' || !activation)
      throw new ValidationError(undefined, {
        details: { reason: 'not_active', nextScreen: app.nextScreen },
      });
    return {
      applicationStatus: 'ACTIVE',
      pmsAccountId: activation.pmsAccountId,
      onboardingComplete: true,
      firstInvestmentStatus: 'NOT_STARTED',
      nextScreen: 'PORTFOLIO',
    };
  }

  /** Internal feed: authenticated provider evidence of actual receipt. Duplicate keys never double-count. */
  async recordReceipt(feed: ReceiptFeed): Promise<{
    receiptId: string;
    status: 'RECORDED' | 'DUPLICATE';
    matchStatus: string;
    fundingStatus: FundingStatus;
  }> {
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const app = await this.applications.findById(feed.applicationId, tx);
      if (!app) throw new NotFoundError();
      const verified = await this.verifiedAccountFingerprint(app.id, tx);
      const reconciled = reconcileReceipt(
        {
          amountInr: feed.amountInr,
          currency: feed.currency,
          sourceAccountFingerprint: feed.sourceAccountNumber
            ? this.fingerprint.of(feed.sourceAccountNumber, 'account')
            : undefined,
          destinationReference: feed.destinationReference,
        },
        {
          currency: this.rulebook.currency,
          sourceAccountFingerprint: verified,
          paymentReference: paymentReference(
            app.id,
            this.rulebook.referencePrefix,
          ),
        },
      );
      const { inserted, receipt } = await this.funding.insertReceiptIfNew(
        {
          id: this.ids.prefixed(ID_PREFIX.fundingReceipt),
          applicationId: app.id,
          providerReceiptKey: feed.providerReceiptKey,
          provider: feed.provider,
          amountInr: Math.round(feed.amountInr),
          currency: feed.currency,
          sourceAccountFingerprint: feed.sourceAccountNumber
            ? this.fingerprint.of(feed.sourceAccountNumber, 'account')
            : undefined,
          destinationReference: feed.destinationReference,
          valueDate: feed.valueDate,
          matchStatus: reconciled.matchStatus,
          mismatchReasons: reconciled.reasons,
          receivedAt: now,
        },
        tx,
      );
      const required = await this.requiredAmount(app.id, tx);
      const before = fundingStatusFor(
        (await this.funding.sumMatched(app.id, tx)) -
          (inserted && receipt.matchStatus === 'MATCHED'
            ? receipt.amountInr
            : 0),
        required,
      );
      const after = fundingStatusFor(
        await this.funding.sumMatched(app.id, tx),
        required,
      );
      if (!inserted)
        return {
          receiptId: receipt.id,
          status: 'DUPLICATE',
          matchStatus: receipt.matchStatus,
          fundingStatus: after,
        };
      await this.audit.append(
        {
          actorType: 'PARTNER',
          actorId: feed.provider,
          action: 'funding_receipt.recorded',
          aggregateType: 'application',
          aggregateId: app.id,
          details: {
            receiptId: receipt.id,
            matchStatus: receipt.matchStatus,
            reasons: receipt.mismatchReasons,
            fundingStatus: after,
          },
        },
        tx,
      );
      if (receipt.matchStatus === 'UNMATCHED')
        await this.tasks.create(
          {
            id: this.ids.prefixed(ID_PREFIX.task),
            applicationId: app.id,
            category: 'FUNDING_REVIEW',
            status: 'OPEN',
            details: {
              receiptId: receipt.id,
              reasons: receipt.mismatchReasons,
            },
            createdAt: now,
          },
          tx,
        );
      if (after === 'RECONCILED' && before !== 'RECONCILED') {
        await this.outbox.add(
          {
            aggregateType: 'application',
            aggregateId: app.id,
            eventType: 'FundingRequirementMet',
            payload: { receiptId: receipt.id, applicationId: app.id },
          },
          tx,
        );
        await this.analytics.track(
          {
            name: 'Funding Requirement Met',
            identity: app.customerId,
            applicationId: app.id,
            screenId: SCREEN_FUNDING_STATUS,
            outcome: 'reconciled',
          },
          tx,
        );
      }
      await this.analytics.track(
        {
          name: 'Funding Reconciliation Updated',
          identity: app.customerId,
          applicationId: app.id,
          screenId: SCREEN_FUNDING_STATUS,
          outcome: receipt.matchStatus.toLowerCase(),
        },
        tx,
      );
      return {
        receiptId: receipt.id,
        status: 'RECORDED',
        matchStatus: receipt.matchStatus,
        fundingStatus: after,
      };
    });
  }

  /** Shared by the status screen and the activation job so both see the same gates. */
  async evaluateGates(
    app: OnboardingApplication,
    tx?: TransactionContext,
  ): Promise<GateEvaluation> {
    const [
      session,
      accounts,
      matched,
      required,
      screening,
      aml,
      open,
      submissions,
    ] = await Promise.all([
      this.signing.latestForApplication(app.id, tx),
      this.accounts.listUnderlyingAccounts(app.id, tx),
      this.funding.sumMatched(app.id, tx),
      this.requiredAmount(app.id, tx),
      this.compliance.latestScreeningRun(app.id, tx),
      this.compliance.latestAmlAssessment(app.id, tx),
      this.tasks.listOpen(app.id, tx),
      this.accounts.listSubmissions(app.id, tx),
    ]);
    const fundingStatus = fundingStatusFor(matched, required);
    const gates = evaluateActivationGates(
      {
        app,
        signingStatus: session?.status,
        accountsReady: accountsReady(accounts, this.accountRulebook),
        fundingStatus,
        screeningStatus: screening?.status,
        amlStatus: aml?.status,
        openTaskCategories: open
          .filter((t) => t.status !== 'RESOLVED')
          .map((t) => t.category),
        registryStatuses: submissions.map((s) => s.status),
      },
      this.activationRulebook,
    );
    return {
      ...gates,
      fundingStatus,
      pmsAccountReference: accounts.find(
        (a) => a.accountType === 'PMS_ACCOUNT' && a.status === 'READY',
      )?.accountReference,
    };
  }

  private async owned(
    applicationId: string,
    customerId: string,
    tx?: TransactionContext,
  ): Promise<OnboardingApplication> {
    const app = await this.applications.findById(applicationId, tx);
    if (!app || app.customerId !== customerId) throw new NotFoundError();
    return app;
  }
  /** SEBI gate: no funding instructions before the agreement is executed and the receiving arrangement exists. */
  private async assertFundingReleased(
    app: OnboardingApplication,
    tx?: TransactionContext,
  ): Promise<void> {
    const session = await this.signing.latestForApplication(app.id, tx);
    const accounts = await this.accounts.listUnderlyingAccounts(app.id, tx);
    const blockers: string[] = [];
    if (session?.status !== 'EXECUTED') blockers.push('documents_not_executed');
    if (!accountsReady(accounts, this.accountRulebook))
      blockers.push('accounts_not_ready');
    if (app.status !== 'SUBMITTED' && app.status !== 'ACTIVE')
      blockers.push('application_not_submitted');
    if (blockers.length)
      throw new ValidationError(undefined, {
        details: {
          reason: blockers[0],
          blockers,
          nextScreen: 'APPLICATION_PROCESSING',
        },
      });
  }
  private async requiredAmount(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<number> {
    const e = await this.eligibility.latest(applicationId, tx);
    return e?.input.intendedInvestmentInr ?? 0;
  }
  private async verifiedAccountFingerprint(
    applicationId: string,
    tx?: TransactionContext,
  ): Promise<string | undefined> {
    const v = await this.bank.latestVerification(applicationId, tx);
    if (v?.status !== 'VERIFIED') return undefined;
    const account = await this.bank.findAccount(v.bankAccountId, tx);
    return account
      ? this.fingerprint.of(account.accountNumber, 'account')
      : undefined;
  }
}

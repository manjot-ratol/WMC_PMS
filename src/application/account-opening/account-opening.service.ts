import { Inject, Injectable } from '@nestjs/common';
import {
  NotFoundError,
  StaleVersionError,
  ValidationError,
} from '../../common/errors/app-error';
import {
  accountsReady,
  ACCOUNT_OPENING_RULEBOOK,
  type AccountOpeningRulebook,
  type UnderlyingAccount,
} from '../../domain/account-opening/account-opening';
import { completeStep } from '../../domain/onboarding/application';
import { ID_PREFIX } from '../../domain/shared/public-id';
import {
  ACCOUNT_OPENING_REPOSITORY,
  type AccountOpeningRepositoryPort,
} from '../ports/account-opening.repository.port';
import { ANALYTICS, type AnalyticsPort } from '../ports/analytics.port';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepositoryPort,
} from '../ports/application.repository.port';
import { AUDIT, type AuditPort } from '../ports/audit.port';
import { CLOCK, type ClockPort } from '../ports/clock.port';
import { ID_GENERATOR, type IdGeneratorPort } from '../ports/id-generator.port';
import { OUTBOX, type OutboxPort } from '../ports/outbox.port';
import {
  REVIEW_REPOSITORY,
  type ReviewRepositoryPort,
} from '../ports/review.repository.port';
import { UNIT_OF_WORK, type UnitOfWork } from '../ports/unit-of-work.port';
import {
  TASK_REPOSITORY,
  type TaskRepositoryPort,
} from '../ports/verification.repository.port';

export interface RequestRunCommand {
  applicationId: string;
  snapshotId: string;
  documentPackVersion: number;
  requestedBy: string;
}
export interface UnderlyingAccountFeed {
  applicationId: string;
  providerReceiptKey: string;
  provider: string;
  accountType: string;
  accountReference: string;
  status: UnderlyingAccount['status'];
}
export const SCREEN_ACCOUNTS = '22';

/** Job C entry points: ops re-queue of the account-opening run and the custodian/DP readiness feed. */
@Injectable()
export class AccountOpeningService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
    @Inject(REVIEW_REPOSITORY) private readonly reviews: ReviewRepositoryPort,
    @Inject(ACCOUNT_OPENING_REPOSITORY)
    private readonly accounts: AccountOpeningRepositoryPort,
    @Inject(TASK_REPOSITORY) private readonly tasks: TaskRepositoryPort,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
    @Inject(ANALYTICS) private readonly analytics: AnalyticsPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    @Inject(ACCOUNT_OPENING_RULEBOOK)
    private readonly rulebook: AccountOpeningRulebook,
  ) {}

  async requestRun(
    cmd: RequestRunCommand,
  ): Promise<{ runId: string; status: 'QUEUED' }> {
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const app = await this.applications.findById(cmd.applicationId, tx);
      if (!app) throw new NotFoundError();
      const snapshot = await this.reviews.current(app.id, tx);
      if (
        !snapshot ||
        snapshot.id !== cmd.snapshotId ||
        snapshot.documentPackVersion !== cmd.documentPackVersion
      )
        throw new StaleVersionError(undefined, {
          details: {
            currentSnapshotId: snapshot?.id,
            currentDocumentPackVersion: snapshot?.documentPackVersion,
          },
        });
      const id = this.ids.prefixed(ID_PREFIX.accountOpeningRun);
      await this.accounts.createRun(
        {
          id,
          applicationId: app.id,
          snapshotId: snapshot.id,
          documentPackVersion: snapshot.documentPackVersion,
          status: 'QUEUED',
          blockers: [],
          createdAt: now,
          updatedAt: now,
        },
        tx,
      );
      await this.audit.append(
        {
          actorType: 'REVIEWER',
          actorId: cmd.requestedBy,
          action: 'account_opening.run_requested',
          aggregateType: 'application',
          aggregateId: app.id,
          details: { runId: id, snapshotId: snapshot.id },
        },
        tx,
      );
      await this.outbox.add(
        {
          aggregateType: 'application',
          aggregateId: app.id,
          eventType: 'AccountOpeningRequested',
          payload: { runId: id },
        },
        tx,
      );
      return { runId: id, status: 'QUEUED' };
    });
  }

  /** Idempotent on the provider receipt key; readiness is evaluated against the rulebook's required account types. */
  async recordUnderlyingAccount(feed: UnderlyingAccountFeed): Promise<{
    accountId: string;
    status: 'RECORDED' | 'DUPLICATE';
    accountsReady: boolean;
  }> {
    if (!['PENDING', 'READY', 'REJECTED'].includes(feed.status))
      throw new ValidationError(undefined, { details: { field: 'status' } });
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const app = await this.applications.findById(feed.applicationId, tx);
      if (!app) throw new NotFoundError();
      const { inserted, account } =
        await this.accounts.insertUnderlyingAccountIfNew(
          {
            id: this.ids.prefixed(ID_PREFIX.underlyingAccount),
            applicationId: app.id,
            providerReceiptKey: feed.providerReceiptKey,
            provider: feed.provider,
            accountType: feed.accountType,
            accountReference: feed.accountReference,
            status: feed.status,
            receivedAt: now,
          },
          tx,
        );
      if (!inserted)
        return {
          accountId: account.id,
          status: 'DUPLICATE',
          accountsReady: accountsReady(
            await this.accounts.listUnderlyingAccounts(app.id, tx),
            this.rulebook,
          ),
        };
      await this.audit.append(
        {
          actorType: 'PARTNER',
          actorId: feed.provider,
          action: 'underlying_account.recorded',
          aggregateType: 'application',
          aggregateId: app.id,
          details: {
            accountId: account.id,
            accountType: feed.accountType,
            status: feed.status,
          },
        },
        tx,
      );
      const ready = accountsReady(
        await this.accounts.listUnderlyingAccounts(app.id, tx),
        this.rulebook,
      );
      const run = await this.accounts.latestRun(app.id, tx);
      if (
        ready &&
        run &&
        run.status !== 'ACCOUNTS_READY' &&
        app.status === 'SUBMITTED'
      ) {
        await this.accounts.updateRun(
          {
            ...run,
            status: 'ACCOUNTS_READY',
            updatedAt: now,
            completedAt: now,
          },
          tx,
        );
        for (const t of await this.tasks.listOpen(app.id, tx))
          if (t.category === 'ACCOUNT_SETUP')
            await this.tasks.update(
              { ...t, status: 'RESOLVED', resolvedAt: now },
              tx,
            );
        await this.applications.saveWithVersionCheck(
          completeStep(app, 'ACCOUNT_OPENING', 'FUNDING_INSTRUCTIONS', now),
          app.version,
          tx,
        );
        await this.outbox.add(
          {
            aggregateType: 'application',
            aggregateId: app.id,
            eventType: 'UnderlyingAccountReady',
            payload: { runId: run.id, applicationId: app.id },
          },
          tx,
        );
        await this.analytics.track(
          {
            name: 'Underlying Account Ready',
            identity: app.customerId,
            applicationId: app.id,
            screenId: SCREEN_ACCOUNTS,
            outcome: 'ready',
          },
          tx,
        );
      }
      return {
        accountId: account.id,
        status: 'RECORDED',
        accountsReady: ready,
      };
    });
  }
}

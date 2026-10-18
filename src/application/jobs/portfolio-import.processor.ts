import { Processor } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { CorrelationStore } from '../../common/correlation/correlation.store';
import { AppLogger } from '../../common/logging/logger.service';
import { parseCasSummary } from '../../domain/portfolio/cas-parser';
import {
  evaluateCallback,
  TERMINAL_IMPORT_STATUSES,
  type PortfolioFailureCategory,
  type PortfolioImport,
} from '../../domain/portfolio/portfolio-import';
import { ID_PREFIX } from '../../domain/shared/public-id';
import { BaseProcessor } from '../../infrastructure/queue/base.processor';
import { QUEUES } from '../../infrastructure/queue/queue.names';
import { ANALYTICS, type AnalyticsPort } from '../ports/analytics.port';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepositoryPort,
} from '../ports/application.repository.port';
import { AUDIT, type AuditPort } from '../ports/audit.port';
import { CLOCK, type ClockPort } from '../ports/clock.port';
import { ID_GENERATOR, type IdGeneratorPort } from '../ports/id-generator.port';
import {
  IDENTITY_REPOSITORY,
  type IdentityRepositoryPort,
} from '../ports/identity.repository.port';
import { INBOX, type InboxPort } from '../ports/inbox.port';
import {
  MFCENTRAL_GATEWAY,
  type MfCentralGatewayPort,
} from '../ports/mfcentral-gateway.port';
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from '../ports/object-storage.port';
import {
  PORTFOLIO_REPOSITORY,
  type PortfolioRepositoryPort,
} from '../ports/portfolio.repository.port';
import { UNIT_OF_WORK, type UnitOfWork } from '../ports/unit-of-work.port';
import type { PortfolioCompletePayload } from '../portfolio/mfcentral-callback.service';
import {
  PortfolioImportService,
  SCREEN_PORTFOLIO_IMPORT,
} from '../portfolio/portfolio-import.service';

/** Screen 06A completion: decrypt and parse the statement MF Central returned, snapshot it, advance the journey. */
@Processor(QUEUES.PORTFOLIO)
export class PortfolioImportProcessor extends BaseProcessor<PortfolioCompletePayload> {
  private readonly logger: AppLogger;
  constructor(
    store: CorrelationStore,
    logger: AppLogger,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
    @Inject(PORTFOLIO_REPOSITORY)
    private readonly portfolio: PortfolioRepositoryPort,
    @Inject(IDENTITY_REPOSITORY)
    private readonly identities: IdentityRepositoryPort,
    @Inject(INBOX) private readonly inbox: InboxPort,
    @Inject(MFCENTRAL_GATEWAY) private readonly mfcentral: MfCentralGatewayPort,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(ANALYTICS) private readonly analytics: AnalyticsPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    private readonly service: PortfolioImportService,
  ) {
    super(store);
    this.logger = logger.child('PortfolioImportProcessor');
  }

  async handle(data: PortfolioCompletePayload): Promise<void> {
    const [imp, row] = await Promise.all([
      this.portfolio.findImport(data.importId),
      this.inbox.get(data.inboxId),
    ]);
    if (!imp || !row || row.status === 'PROCESSED') return;
    if (TERMINAL_IMPORT_STATUSES.includes(imp.status)) {
      await this.inbox.markProcessed(row.id);
      return;
    }
    const now = this.clock.now();
    const evaluation = evaluateCallback(
      (row.payload ?? {}) as Record<string, unknown>,
    );
    try {
      if (evaluation.outcome !== 'AUTHORISED') {
        await this.finish(
          imp,
          evaluation.outcome === 'DECLINED' ? 'DECLINED' : 'FAILED',
          evaluation.category,
          now,
        );
      } else {
        await this.import(imp, evaluation.cipher, now);
      }
      await this.inbox.markProcessed(row.id);
    } catch (err) {
      await this.inbox.markFailed(
        row.id,
        err instanceof Error ? err.message : String(err),
      );
      throw err;
    }
  }

  private async import(
    imp: PortfolioImport,
    cipher: string,
    now: Date,
  ): Promise<void> {
    const identity = await this.identities.latest(imp.applicationId);
    let parsed;
    let raw: unknown;
    try {
      raw = JSON.parse(await this.mfcentral.decrypt(cipher)) as unknown;
      parsed = parseCasSummary(raw, {
        pan: identity?.pan ?? '',
        asOf: now,
      });
    } catch (err) {
      this.logger.warn('portfolio_import.invalid_payload', {
        importId: imp.id,
        reason: err instanceof Error ? err.message : String(err),
      });
      await this.finish(imp, 'FAILED', 'invalid_payload', now);
      return;
    }
    const evidenceKey = `portfolio/${imp.applicationId}/${imp.id}/cas.json`;
    await this.storage.put(
      evidenceKey,
      JSON.stringify(raw),
      'application/json',
    );
    await this.uow.run(async (tx) => {
      const app = await this.applications.findById(imp.applicationId, tx);
      if (!app) return;
      const fresh = await this.portfolio.createSnapshot(
        {
          id: this.ids.prefixed(ID_PREFIX.portfolioSnapshot),
          importId: imp.id,
          applicationId: imp.applicationId,
          data: parsed,
          evidenceKey,
          createdAt: now,
        },
        tx,
      );
      if (!fresh) return; // replayed callback: the first run already did everything below
      await this.portfolio.updateImport(
        { ...imp, status: 'IMPORTED', updatedAt: now, completedAt: now },
        tx,
      );
      await this.service.advanceAfterImport(app, now, tx);
      await this.audit.append(
        {
          actorType: 'PARTNER',
          actorId: 'mfcentral',
          action: 'portfolio_import.completed',
          aggregateType: 'application',
          aggregateId: app.id,
          details: {
            importId: imp.id,
            evidenceKey,
            folioCount: parsed.totals.folioCount,
            schemeCount: parsed.totals.schemeCount,
          },
        },
        tx,
      );
      await this.analytics.track(
        {
          name: 'Portfolio Import Completed',
          identity: app.customerId,
          applicationId: app.id,
          screenId: SCREEN_PORTFOLIO_IMPORT,
          outcome: 'imported',
        },
        tx,
      );
    });
  }

  private async finish(
    imp: PortfolioImport,
    status: 'DECLINED' | 'FAILED',
    category: PortfolioFailureCategory,
    now: Date,
  ): Promise<void> {
    await this.uow.run(async (tx) => {
      const app = await this.applications.findById(imp.applicationId, tx);
      if (!app) return;
      await this.portfolio.updateImport(
        {
          ...imp,
          status,
          failureCategory: category,
          updatedAt: now,
          completedAt: now,
        },
        tx,
      );
      // Declining consent is a decision, so the journey moves on; a broken payload keeps the retry/skip choice.
      if (status === 'DECLINED')
        await this.service.advanceAfterImport(app, now, tx);
      await this.audit.append(
        {
          actorType: 'PARTNER',
          actorId: 'mfcentral',
          action: 'portfolio_import.not_imported',
          aggregateType: 'application',
          aggregateId: app.id,
          details: { importId: imp.id, status, category },
        },
        tx,
      );
      await this.analytics.track(
        {
          name: 'Portfolio Import Completed',
          identity: app.customerId,
          applicationId: app.id,
          screenId: SCREEN_PORTFOLIO_IMPORT,
          outcome: status.toLowerCase(),
          safeErrorCategory: category,
        },
        tx,
      );
    });
  }
}

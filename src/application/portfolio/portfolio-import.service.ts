import { Inject, Injectable } from '@nestjs/common';
import { partnersConfig } from '../../common/config/partners.config';
import {
  NotFoundError,
  PartnerRejectedError,
  ValidationError,
} from '../../common/errors/app-error';
import { kycNextScreen } from '../../domain/kyc/kyc-record';
import {
  completeStep,
  hasCompleted,
  requireStep,
  type OnboardingApplication,
} from '../../domain/onboarding/application';
import type { Screen } from '../../domain/onboarding/screens';
import {
  parseCasSummary,
  type PortfolioSnapshotData,
} from '../../domain/portfolio/cas-parser';
import {
  effectiveStatus,
  importNextScreen,
  isOpen,
  type PortfolioFailureCategory,
  type PortfolioImport,
  type PortfolioImportStatus,
  type ReturnEvaluation,
} from '../../domain/portfolio/portfolio-import';
import { ID_PREFIX } from '../../domain/shared/public-id';
import { ANALYTICS, type AnalyticsPort } from '../ports/analytics.port';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepositoryPort,
} from '../ports/application.repository.port';
import { AUDIT, type AuditPort } from '../ports/audit.port';
import { CLOCK, type ClockPort } from '../ports/clock.port';
import {
  CUSTOMER_REPOSITORY,
  type CustomerRepositoryPort,
} from '../ports/customer.repository.port';
import { ID_GENERATOR, type IdGeneratorPort } from '../ports/id-generator.port';
import {
  IDENTITY_REPOSITORY,
  type IdentityRepositoryPort,
} from '../ports/identity.repository.port';
import {
  KYC_RECORD_REPOSITORY,
  type KycRecordRepositoryPort,
} from '../ports/kyc.repository.port';
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
import {
  UNIT_OF_WORK,
  type TransactionContext,
  type UnitOfWork,
} from '../ports/unit-of-work.port';

export const SCREEN_PORTFOLIO_IMPORT = '06A';
export const SCREEN_ASSETS_DASHBOARD = '06B';

export interface PortfolioImportView {
  importId: string;
  status: PortfolioImportStatus;
  failureCategory?: PortfolioFailureCategory;
  lastError?: string;
  authorisationUrl?: string;
  expiresAt?: Date;
  nextScreen: Screen;
}
export interface PortfolioView {
  status: 'AVAILABLE' | 'NOT_AVAILABLE' | 'SKIPPED';
  importId?: string;
  data?: PortfolioSnapshotData;
  nextScreen: Screen;
}

/**
 * Screens 06A/06B: MF Central CAS import after PAN identity, as the MFC-CAS integration document describes it:
 * `newCasRequest` → encrypted hand-off to MF Central's page (OTP, data choice, QR download) → MF Central returns the
 * browser with a status → the customer uploads the QR → `validateQRCode` returns the statement. The step is optional
 * (skip completes it); holdings are shown back masked and never reach analytics.
 */
@Injectable()
export class PortfolioImportService {
  private readonly ttlMs: number;
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
    @Inject(CUSTOMER_REPOSITORY)
    private readonly customers: CustomerRepositoryPort,
    @Inject(IDENTITY_REPOSITORY)
    private readonly identities: IdentityRepositoryPort,
    @Inject(KYC_RECORD_REPOSITORY)
    private readonly kycRecords: KycRecordRepositoryPort,
    @Inject(PORTFOLIO_REPOSITORY)
    private readonly imports: PortfolioRepositoryPort,
    @Inject(MFCENTRAL_GATEWAY) private readonly mfcentral: MfCentralGatewayPort,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(ANALYTICS) private readonly analytics: AnalyticsPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    @Inject(partnersConfig.KEY)
    private readonly partners: ReturnType<typeof partnersConfig>,
  ) {
    this.ttlMs = partners.mfcentral.importTtlMinutes * 60_000;
  }

  async start(cmd: {
    applicationId: string;
    customerId: string;
    consent: boolean;
  }): Promise<PortfolioImportView> {
    if (!cmd.consent)
      throw new ValidationError(undefined, {
        details: { field: 'consent', reason: 'consent_required' },
      });
    const app = await this.loadApplication(cmd.applicationId, cmd.customerId);
    requireStep(app, 'IDENTITY');
    const now = this.clock.now();
    const latest = await this.imports.latestImport(app.id);
    if (latest && (isOpen(latest, now) || latest.status === 'IMPORTED'))
      return this.view(latest, app, now); // one open request at a time; an imported one is final

    const [identity, customer] = await Promise.all([
      this.identities.latest(app.id),
      this.customers.findById(cmd.customerId),
    ]);
    if (!identity || !customer)
      throw new ValidationError(undefined, {
        details: { reason: 'identity_unavailable' },
      });
    const id = this.ids.prefixed(ID_PREFIX.portfolioImport);
    const base: PortfolioImport = {
      id,
      applicationId: app.id,
      provider: 'MFCENTRAL',
      status: 'AWAITING_AUTHORISATION',
      clientRefNo: id,
      expiresAt: new Date(now.getTime() + this.ttlMs),
      createdAt: now,
      updatedAt: now,
    };
    // MF Central takes mobile OR email, never both; the verified phone is the investor's OTP channel.
    const contact = {
      mobile: customer.phone,
      email: customer.phone
        ? undefined
        : customer.emailVerifiedAt
          ? customer.email
          : undefined,
    };

    let created: PortfolioImport;
    try {
      const result = await this.mfcentral.newCasRequest({
        clientRefNo: id,
        pan: identity.pan,
        ...contact,
        redirectUrl: this.partners.mfcentral.redirectUrl,
      });
      if (!result.reqId)
        throw new PartnerRejectedError('mfcentral', 'no_request_id');
      created = {
        ...base,
        providerRequestId: result.reqId,
        authorisationUrl: this.mfcentral.buildHandoffUrl({
          reqId: result.reqId,
          otpRef: result.otpRef ?? '',
          clientRefNo: id,
          pan: identity.pan,
          ...contact,
          redirectUrl: this.partners.mfcentral.redirectUrl,
        }),
      };
    } catch (err) {
      if (!(err instanceof PartnerRejectedError)) throw err; // transport failures: nothing recorded, 503
      created = {
        ...base,
        status: 'FAILED',
        failureCategory: 'provider_rejected',
        completedAt: now,
      };
    }

    await this.uow.run(async (tx) => {
      await this.imports.createImport(created, tx);
      await this.audit.append(
        {
          actorType: 'CUSTOMER',
          actorId: cmd.customerId,
          action: 'portfolio_import.requested',
          aggregateType: 'application',
          aggregateId: app.id,
          details: {
            importId: id,
            status: created.status,
            providerRequestId: created.providerRequestId,
            failureCategory: created.failureCategory,
          },
        },
        tx,
      );
      await this.analytics.track(
        {
          name: 'Portfolio Import Started',
          identity: cmd.customerId,
          applicationId: app.id,
          screenId: SCREEN_PORTFOLIO_IMPORT,
          outcome: created.status === 'FAILED' ? 'failed' : 'requested',
          safeErrorCategory: created.failureCategory,
        },
        tx,
      );
    });
    return this.view(created, app, now);
  }

  /** The return leg from MF Central's page; keyed on their `reqId` because the redirect carries no clientRefNo. */
  async markReturned(
    evaluation: ReturnEvaluation,
  ): Promise<{ importId?: string; status?: PortfolioImportStatus }> {
    if (evaluation.outcome === 'INVALID' || !evaluation.reqId) return {};
    const imp = await this.imports.findImportByProviderRequestId(
      evaluation.reqId,
    );
    if (!imp) return {};
    const now = this.clock.now();
    if (!isOpen(imp, now)) return { importId: imp.id, status: imp.status };
    if (evaluation.outcome === 'SUCCESS') {
      if (imp.status === 'AWAITING_QR')
        return { importId: imp.id, status: imp.status };
      await this.uow.run(async (tx) => {
        await this.imports.updateImport(
          { ...imp, status: 'AWAITING_QR', updatedAt: now },
          tx,
        );
        await this.audit.append(
          {
            actorType: 'PARTNER',
            actorId: 'mfcentral',
            action: 'portfolio_import.returned',
            aggregateType: 'application',
            aggregateId: imp.applicationId,
            details: { importId: imp.id, type: evaluation.type },
          },
          tx,
        );
      });
      return { importId: imp.id, status: 'AWAITING_QR' };
    }
    await this.uow.run(async (tx) => {
      const app = await this.applications.findById(imp.applicationId, tx);
      await this.imports.updateImport(
        {
          ...imp,
          status: 'DECLINED',
          failureCategory: 'authorisation_declined',
          lastError: evaluation.message,
          updatedAt: now,
          completedAt: now,
        },
        tx,
      );
      // Declining (or an expired MF Central session) is a decision: the journey moves on.
      if (app) await this.advanceAfterImport(app, now, tx);
      await this.audit.append(
        {
          actorType: 'PARTNER',
          actorId: 'mfcentral',
          action: 'portfolio_import.declined',
          aggregateType: 'application',
          aggregateId: imp.applicationId,
          details: { importId: imp.id, code: evaluation.code },
        },
        tx,
      );
      if (app)
        await this.analytics.track(
          {
            name: 'Portfolio Import Completed',
            identity: app.customerId,
            applicationId: app.id,
            screenId: SCREEN_PORTFOLIO_IMPORT,
            outcome: 'declined',
            safeErrorCategory: 'authorisation_declined',
          },
          tx,
        );
    });
    return { importId: imp.id, status: 'DECLINED' };
  }

  /** The customer uploads the QR image MF Central let them download; `validateQRCode` turns it into the statement. */
  async validateQr(cmd: {
    applicationId: string;
    customerId: string;
    importId: string;
    qrCode: string;
  }): Promise<PortfolioImportView> {
    const app = await this.loadApplication(cmd.applicationId, cmd.customerId);
    const imp = await this.imports.findImport(cmd.importId);
    if (!imp || imp.applicationId !== app.id) throw new NotFoundError();
    const now = this.clock.now();
    if (imp.status === 'IMPORTED') return this.view(imp, app, now);
    if (!isOpen(imp, now) || !imp.providerRequestId)
      throw new ValidationError(undefined, {
        details: {
          reason: 'import_not_open',
          status: effectiveStatus(imp, now),
        },
      });
    const identity = await this.identities.latest(app.id);

    let raw: unknown;
    try {
      raw = (
        await this.mfcentral.validateQrCode({
          clientRefNo: imp.clientRefNo,
          reqId: imp.providerRequestId,
          qrCode: cmd.qrCode.replace(/^data:image\/\w+;base64,/, ''),
        })
      ).raw;
    } catch (err) {
      if (!(err instanceof PartnerRejectedError)) throw err;
      const message = vendorMessage(err) ?? 'QR code not accepted';
      await this.imports.updateImport({
        ...imp,
        lastError: message,
        updatedAt: now,
      });
      throw new ValidationError(message, {
        details: { reason: 'qr_invalid', importId: imp.id },
      });
    }

    let parsed: PortfolioSnapshotData;
    try {
      parsed = parseCasSummary(raw, { pan: identity?.pan ?? '', asOf: now });
    } catch {
      const failed: PortfolioImport = {
        ...imp,
        status: 'FAILED',
        failureCategory: 'invalid_payload',
        updatedAt: now,
        completedAt: now,
      };
      await this.imports.updateImport(failed);
      return this.view(failed, app, now);
    }
    const evidenceKey = `portfolio/${app.id}/${imp.id}/cas.json`;
    await this.storage.put(
      evidenceKey,
      JSON.stringify(raw),
      'application/json',
    );
    const imported: PortfolioImport = {
      ...imp,
      status: 'IMPORTED',
      lastError: undefined,
      updatedAt: now,
      completedAt: now,
    };
    const advanced = await this.uow.run(async (tx) => {
      const fresh = await this.imports.createSnapshot(
        {
          id: this.ids.prefixed(ID_PREFIX.portfolioSnapshot),
          importId: imp.id,
          applicationId: app.id,
          data: parsed,
          evidenceKey,
          createdAt: now,
        },
        tx,
      );
      if (!fresh) return app;
      await this.imports.updateImport(imported, tx);
      const next = await this.advanceAfterImport(app, now, tx);
      await this.audit.append(
        {
          actorType: 'CUSTOMER',
          actorId: cmd.customerId,
          action: 'portfolio_import.completed',
          aggregateType: 'application',
          aggregateId: app.id,
          details: {
            importId: imp.id,
            evidenceKey,
            folioCount: parsed.totals.folioCount,
            schemeCount: parsed.totals.schemeCount,
            partial: parsed.partial,
          },
        },
        tx,
      );
      await this.analytics.track(
        {
          name: 'Portfolio Import Completed',
          identity: cmd.customerId,
          applicationId: app.id,
          screenId: SCREEN_PORTFOLIO_IMPORT,
          outcome: 'imported',
        },
        tx,
      );
      return next;
    });
    return this.view(imported, advanced, now);
  }

  async get(cmd: {
    applicationId: string;
    customerId: string;
    importId: string;
  }): Promise<PortfolioImportView> {
    const app = await this.loadApplication(
      cmd.applicationId,
      cmd.customerId,
      true,
    );
    const imp = await this.imports.findImport(cmd.importId);
    if (!imp || imp.applicationId !== app.id) throw new NotFoundError();
    return this.view(imp, app, this.clock.now());
  }

  async skip(cmd: {
    applicationId: string;
    customerId: string;
  }): Promise<{ status: 'SKIPPED'; nextScreen: Screen }> {
    const app = await this.loadApplication(cmd.applicationId, cmd.customerId);
    requireStep(app, 'IDENTITY');
    const now = this.clock.now();
    const latest = await this.imports.latestImport(app.id);
    if (latest?.status === 'IMPORTED')
      throw new ValidationError(undefined, {
        details: { reason: 'already_imported', importId: latest.id },
      });
    const nextScreen = await this.uow.run(async (tx) => {
      if (
        latest &&
        (latest.status === 'AWAITING_AUTHORISATION' ||
          latest.status === 'AWAITING_QR')
      )
        await this.imports.updateImport(
          { ...latest, status: 'SKIPPED', updatedAt: now, completedAt: now },
          tx,
        );
      else if (!latest || latest.status !== 'SKIPPED') {
        const id = this.ids.prefixed(ID_PREFIX.portfolioImport);
        await this.imports.createImport(
          {
            id,
            applicationId: app.id,
            provider: 'MFCENTRAL',
            status: 'SKIPPED',
            clientRefNo: id,
            expiresAt: now,
            createdAt: now,
            updatedAt: now,
            completedAt: now,
          },
          tx,
        );
      }
      const advanced = await this.advanceAfterImport(app, now, tx);
      await this.audit.append(
        {
          actorType: 'CUSTOMER',
          actorId: cmd.customerId,
          action: 'portfolio_import.skipped',
          aggregateType: 'application',
          aggregateId: app.id,
          details: { importId: latest?.id },
        },
        tx,
      );
      await this.analytics.track(
        {
          name: 'Portfolio Import Skipped',
          identity: cmd.customerId,
          applicationId: app.id,
          screenId: SCREEN_PORTFOLIO_IMPORT,
          outcome: 'skipped',
        },
        tx,
      );
      return advanced.nextScreen;
    });
    return { status: 'SKIPPED', nextScreen };
  }

  async portfolio(cmd: {
    applicationId: string;
    customerId: string;
  }): Promise<PortfolioView> {
    const app = await this.loadApplication(
      cmd.applicationId,
      cmd.customerId,
      true,
    );
    const [snapshot, latest] = await Promise.all([
      this.imports.latestSnapshot(app.id),
      this.imports.latestImport(app.id),
    ]);
    const nextScreen = hasCompleted(app, 'PORTFOLIO_IMPORT')
      ? await this.afterImportScreen(app)
      : 'PORTFOLIO_IMPORT';
    if (snapshot)
      return {
        status: 'AVAILABLE',
        importId: snapshot.importId,
        data: snapshot.data,
        nextScreen,
      };
    return {
      status: latest?.status === 'SKIPPED' ? 'SKIPPED' : 'NOT_AVAILABLE',
      importId: latest?.id,
      nextScreen,
    };
  }

  /** Completes step PORTFOLIO_IMPORT and points the journey at wherever the KYC lookup has got to. */
  async advanceAfterImport(
    app: OnboardingApplication,
    now: Date,
    tx?: TransactionContext,
  ): Promise<OnboardingApplication> {
    const next = await this.afterImportScreen(app, tx);
    const advanced = completeStep(app, 'PORTFOLIO_IMPORT', next, now);
    if (advanced !== app)
      await this.applications.saveWithVersionCheck(advanced, app.version, tx);
    return advanced;
  }

  async afterImportScreen(
    app: OnboardingApplication,
    tx?: TransactionContext,
  ): Promise<Screen> {
    const record = await this.kycRecords.latestForApplication(app.id, tx);
    return record ? kycNextScreen(record) : 'KYC_PROGRESS';
  }

  private async view(
    imp: PortfolioImport,
    app: OnboardingApplication,
    now: Date,
  ): Promise<PortfolioImportView> {
    const status = effectiveStatus(imp, now);
    const open =
      status === 'AWAITING_AUTHORISATION' || status === 'AWAITING_QR';
    return {
      importId: imp.id,
      status,
      failureCategory: status === 'EXPIRED' ? 'expired' : imp.failureCategory,
      lastError: imp.lastError,
      authorisationUrl: open ? imp.authorisationUrl : undefined,
      expiresAt: open ? imp.expiresAt : undefined,
      nextScreen: importNextScreen(
        status,
        hasCompleted(app, 'PORTFOLIO_IMPORT'),
        await this.afterImportScreen(app),
      ),
    };
  }

  private async loadApplication(
    applicationId: string,
    customerId: string,
    readOnly = false,
  ): Promise<OnboardingApplication> {
    const app = await this.applications.findById(applicationId);
    if (!app || app.customerId !== customerId) throw new NotFoundError();
    if (!readOnly && app.status !== 'IN_PROGRESS')
      throw new ValidationError(undefined, {
        details: { applicationStatus: app.status },
      });
    return app;
  }
}

function vendorMessage(err: PartnerRejectedError): string | undefined {
  const errors = (
    err.details as { vendorErrors?: { message?: string }[] } | undefined
  )?.vendorErrors;
  return errors?.[0]?.message;
}

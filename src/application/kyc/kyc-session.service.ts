import { Inject, Injectable } from '@nestjs/common';
import { partnersConfig } from '../../common/config/partners.config';
import { NotFoundError, ValidationError } from '../../common/errors/app-error';
import type { KycSession } from '../../domain/kyc/kyc-session';
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
import {
  DIGISTUDIO_GATEWAY,
  type DigiStudioGatewayPort,
} from '../ports/digistudio-gateway.port';
import { ID_GENERATOR, type IdGeneratorPort } from '../ports/id-generator.port';
import {
  KYC_RECORD_REPOSITORY,
  KYC_SESSION_REPOSITORY,
  type KycRecordRepositoryPort,
  type KycSessionRepositoryPort,
} from '../ports/kyc.repository.port';
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from '../ports/object-storage.port';
import { OUTBOX, type OutboxPort } from '../ports/outbox.port';
import { UNIT_OF_WORK, type UnitOfWork } from '../ports/unit-of-work.port';

export interface CreateKycSessionCommand {
  applicationId: string;
  customerId: string;
  method: 'DIGITAL_DOCUMENTS';
  returnRoute?: string;
}
export interface KycSessionCreated {
  sessionId: string;
  status: KycSession['status'];
  provider: 'DIGIO';
  providerRequestId?: string;
  sdkLaunch: { accessToken: string };
  nextScreen: 'PROVIDER_KYC';
}

export const SCREEN_FRESH_KYC = '09';
const ACTIVE: KycSession['status'][] = [
  'REQUESTED',
  'IN_PROGRESS',
  'APPROVAL_PENDING',
];

/** Screen 09: creates (or resumes) a DigiStudio workflow request for fresh KYC. The template is server configuration. */
@Injectable()
export class KycSessionService {
  private readonly templateName: string;

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
    @Inject(CUSTOMER_REPOSITORY)
    private readonly customers: CustomerRepositoryPort,
    @Inject(KYC_RECORD_REPOSITORY)
    private readonly kycRecords: KycRecordRepositoryPort,
    @Inject(KYC_SESSION_REPOSITORY)
    private readonly sessions: KycSessionRepositoryPort,
    @Inject(DIGISTUDIO_GATEWAY)
    private readonly digistudio: DigiStudioGatewayPort,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
    @Inject(ANALYTICS) private readonly analytics: AnalyticsPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    @Inject(partnersConfig.KEY) cfg: ReturnType<typeof partnersConfig>,
  ) {
    this.templateName = cfg.digio.kycTemplateName;
  }

  async create(cmd: CreateKycSessionCommand): Promise<KycSessionCreated> {
    const now = this.clock.now();
    const app = await this.applications.findById(cmd.applicationId);
    if (!app || app.customerId !== cmd.customerId) throw new NotFoundError();
    const record = await this.kycRecords.latestForApplication(app.id);
    if (
      !record ||
      record.status === 'COMPLETE' ||
      !(record.route === 'FRESH' || record.route === 'REMEDIATE')
    ) {
      throw new ValidationError(undefined, {
        details: {
          reason: 'fresh_kyc_not_required',
          nextScreen: app.nextScreen,
        },
      });
    }

    const existing = await this.sessions.latestForApplication(app.id);
    if (existing?.providerRequestId && ACTIVE.includes(existing.status)) {
      const token = await this.digistudio.regenerateAccessToken(
        existing.providerRequestId,
      );
      return {
        sessionId: existing.id,
        status: existing.status,
        provider: 'DIGIO',
        providerRequestId: existing.providerRequestId,
        sdkLaunch: { accessToken: token.id },
        nextScreen: 'PROVIDER_KYC',
      };
    }

    const customer = await this.customers.findById(app.customerId);
    if (!customer) throw new NotFoundError();
    const sessionId = this.ids.prefixed(ID_PREFIX.kycSession);
    const created = await this.digistudio.createRequest({
      customerIdentifier: customer.phone.replace(/^\+/, ''),
      referenceId: app.id,
      transactionId: sessionId,
      templateName: this.templateName,
    });
    if (!created.accessToken)
      throw new ValidationError(undefined, {
        details: { reason: 'sdk_token_missing' },
      });
    const evidenceKey = `applications/${app.id}/kyc-sessions/${sessionId}/create.json`;
    await this.storage.put(
      evidenceKey,
      JSON.stringify(created.raw),
      'application/json',
    );

    await this.uow.run(async (tx) => {
      await this.sessions.create(
        {
          id: sessionId,
          applicationId: app.id,
          provider: 'DIGIO',
          providerRequestId: created.providerRequestId,
          templateName: this.templateName,
          status: 'REQUESTED',
          lastProviderStatus: created.status,
          pollCount: 0,
          createdAt: now,
          updatedAt: now,
        },
        tx,
      );
      await this.applications.saveWithVersionCheck(
        { ...app, nextScreen: 'PROVIDER_KYC', version: app.version + 1 },
        app.version,
        tx,
      );
      await this.audit.append(
        {
          actorType: 'CUSTOMER',
          actorId: cmd.customerId,
          action: 'kyc_session.created',
          aggregateType: 'application',
          aggregateId: app.id,
          details: {
            sessionId,
            providerRequestId: created.providerRequestId,
            templateName: this.templateName,
          },
        },
        tx,
      );
      await this.outbox.add(
        {
          aggregateType: 'application',
          aggregateId: app.id,
          eventType: 'KycSessionCreated',
          payload: { sessionId },
        },
        tx,
      );
      await this.analytics.track(
        {
          name: 'Digital KYC Request Created',
          identity: cmd.customerId,
          applicationId: app.id,
          screenId: SCREEN_FRESH_KYC,
          outcome: 'created',
        },
        tx,
      );
    });
    return {
      sessionId,
      status: 'REQUESTED',
      provider: 'DIGIO',
      providerRequestId: created.providerRequestId,
      sdkLaunch: { accessToken: created.accessToken.id },
      nextScreen: 'PROVIDER_KYC',
    };
  }
}

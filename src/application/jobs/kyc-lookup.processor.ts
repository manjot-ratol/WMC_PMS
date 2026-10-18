import { Processor } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import type { Job } from 'bullmq';
import { CorrelationStore } from '../../common/correlation/correlation.store';
import {
  DependencyUnavailableError,
  PartnerRejectedError,
} from '../../common/errors/app-error';
import { AppLogger } from '../../common/logging/logger.service';
import {
  KYC_RELIANCE_RULEBOOK,
  type KycRelianceRulebook,
} from '../../domain/kyc/kyc-reliance-rulebook';
import {
  kycNextScreen,
  routeKyc,
  type KraSummary,
  type KycRecord,
} from '../../domain/kyc/kyc-record';
import { IPV_RULEBOOK, type IpvRulebook } from '../../domain/ipv/ipv-rulebook';
import { BaseProcessor } from '../../infrastructure/queue/base.processor';
import { QUEUES } from '../../infrastructure/queue/queue.names';
import { ANALYTICS, type AnalyticsPort } from '../ports/analytics.port';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepositoryPort,
} from '../ports/application.repository.port';
import { AUDIT, type AuditPort } from '../ports/audit.port';
import { CLOCK, type ClockPort } from '../ports/clock.port';
import {
  IDENTITY_REPOSITORY,
  type IdentityRepositoryPort,
} from '../ports/identity.repository.port';
import {
  KRA_GATEWAY,
  type KraGatewayPort,
  type KraRecord,
} from '../ports/kra-gateway.port';
import {
  KYC_RECORD_REPOSITORY,
  type KycRecordRepositoryPort,
} from '../ports/kyc.repository.port';
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from '../ports/object-storage.port';
import { UNIT_OF_WORK, type UnitOfWork } from '../ports/unit-of-work.port';
import { SCREEN_IDENTITY } from '../kyc/identity.service';

export interface KycLookupPayload {
  outboxId?: string;
  aggregateId: string;
  payload: {
    kycRecordId: string;
    identityVersion: number;
    operationId: string;
  };
}

/** Job A of screen 06/07: KRA status + fetch, routing via the reliance rulebook, evidence to object storage. */
@Processor(QUEUES.IDENTITY)
export class KycLookupProcessor extends BaseProcessor<KycLookupPayload> {
  private readonly logger: AppLogger;

  constructor(
    store: CorrelationStore,
    logger: AppLogger,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepositoryPort,
    @Inject(IDENTITY_REPOSITORY)
    private readonly identities: IdentityRepositoryPort,
    @Inject(KYC_RECORD_REPOSITORY)
    private readonly kycRecords: KycRecordRepositoryPort,
    @Inject(KRA_GATEWAY) private readonly kra: KraGatewayPort,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(ANALYTICS) private readonly analytics: AnalyticsPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(KYC_RELIANCE_RULEBOOK)
    private readonly rulebook: KycRelianceRulebook,
    @Inject(IPV_RULEBOOK) private readonly ipvRulebook: IpvRulebook,
  ) {
    super(store);
    this.logger = logger.child('KycLookupProcessor');
  }

  async handle(data: KycLookupPayload, job: Job): Promise<void> {
    const { kycRecordId } = data.payload;
    const record = await this.kycRecords.findById(kycRecordId);
    if (!record || record.status !== 'PROCESSING') return; // already handled: idempotent redelivery
    const identity = await this.identities.latest(record.applicationId);
    if (!identity || identity.version !== record.identityVersion) return;
    const now = this.clock.now();

    let outcome:
      | {
          summary: KraSummary;
          routing: ReturnType<typeof routeKyc>;
          evidence: unknown;
        }
      | undefined;
    let technical: string | undefined;
    try {
      const status = await this.kra.checkPanStatus({
        pan: identity.pan,
        dob: identity.dateOfBirth,
        fetchType: 'I',
        uniqueRequestId: `${record.operationId}-s`,
      });
      const found = Boolean(status.statusCode);
      let fetched: KraRecord | undefined;
      if (found)
        fetched = await this.kra.fetchDetails({
          pan: identity.pan,
          dob: identity.dateOfBirth,
          fetchType: 'I',
          uniqueRequestId: `${record.operationId}-f`,
        });
      const summary: KraSummary = {
        name: fetched?.name ?? status.name,
        dob: fetched?.dob,
        statusCode: fetched?.kyc.statusCode ?? status.statusCode,
        status: fetched?.kyc.status ?? status.status,
        statusDescription:
          fetched?.kyc.statusDescription ?? status.statusDescription,
        statusDate: fetched?.kyc.statusDate ?? status.statusDate,
        ipvFlag: fetched?.kyc.ipvFlag ?? status.ipvFlag,
        kra: fetched?.kraInfo?.kra,
        internalReference: fetched?.kyc.internalReference,
        correspondenceAddress: fetched?.correspondenceAddress,
        errorCode: fetched?.error?.code,
      };
      const routing = routeKyc(
        {
          found,
          statusCode: summary.statusCode,
          errorCode: summary.errorCode,
          statusDate: summary.statusDate,
          ipvFlag: summary.ipvFlag,
        },
        this.rulebook,
        now,
      );
      outcome = {
        summary,
        routing,
        evidence: { status: status.raw, record: fetched?.raw ?? null },
      };
    } catch (err) {
      if (err instanceof DependencyUnavailableError) {
        const attempts = job.opts?.attempts ?? 1;
        if (job.attemptsMade + 1 < attempts) throw err; // let BullMQ retry with backoff
        technical = 'provider_unavailable';
      } else if (err instanceof PartnerRejectedError) {
        technical = 'provider_rejected';
      } else {
        throw err;
      }
      this.logger.warn('kyc_lookup.technical_error', {
        kycRecordId,
        category: technical,
        err,
      });
    }

    let evidenceKey: string | undefined;
    if (outcome) {
      evidenceKey = `applications/${record.applicationId}/kyc/${record.id}/kra-${now.getTime()}.json`;
      await this.storage.put(
        evidenceKey,
        JSON.stringify(outcome.evidence),
        'application/json',
      );
    }

    await this.uow.run(async (tx) => {
      const app = await this.applications.findById(record.applicationId, tx);
      if (!app) return;
      const updated: KycRecord = outcome
        ? {
            ...record,
            status: outcome.routing.status,
            route: outcome.routing.route,
            summary: outcome.summary,
            evidenceKey,
            version: record.version + 1,
            updatedAt: now,
            ipvExemptionBasis:
              outcome.routing.route === 'REUSE' &&
              this.ipvRulebook.exemptWhenKraIpvFlag &&
              outcome.summary.ipvFlag === 'Y'
                ? 'KRA_IPV_FLAG'
                : undefined,
          }
        : {
            ...record,
            status: 'TECHNICAL_ERROR',
            safeErrorCategory: technical,
            version: record.version + 1,
            updatedAt: now,
          };
      await this.kycRecords.saveWithVersionCheck(updated, record.version, tx);
      const nextScreen = kycNextScreen(updated);
      const status = updated.route === 'ASSISTED' ? 'ASSISTED' : app.status;
      await this.applications.saveWithVersionCheck(
        { ...app, status, nextScreen, version: app.version + 1 },
        app.version,
        tx,
      );
      await this.audit.append(
        {
          actorType: 'PARTNER',
          actorId: 'digio',
          action: 'kyc.lookup_completed',
          aggregateType: 'application',
          aggregateId: app.id,
          details: {
            kycRecordId,
            status: updated.status,
            route: updated.route,
            reason: outcome?.routing.reason,
            category: technical,
          },
        },
        tx,
      );
      await this.analytics.track(
        {
          name: 'Identity Verification Completed',
          identity: app.customerId,
          applicationId: app.id,
          screenId: SCREEN_IDENTITY,
          outcome: outcome ? 'completed' : 'technical_error',
          safeErrorCategory: technical,
        },
        tx,
      );
      if (outcome) {
        await this.analytics.track(
          {
            name: 'KYC Route Assigned',
            identity: app.customerId,
            applicationId: app.id,
            screenId: '07',
            outcome: outcome.routing.route.toLowerCase(),
          },
          tx,
        );
        if (outcome.routing.status === 'EXISTING_RECORD_AVAILABLE')
          await this.analytics.track(
            {
              name: 'Existing KYC Retrieval Completed',
              identity: app.customerId,
              applicationId: app.id,
              screenId: '07',
              outcome: 'retrieved',
            },
            tx,
          );
      }
    });
  }
}

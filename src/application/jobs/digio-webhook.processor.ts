import { Processor } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { CorrelationStore } from '../../common/correlation/correlation.store';
import { AppLogger } from '../../common/logging/logger.service';
import { BaseProcessor } from '../../infrastructure/queue/base.processor';
import { QUEUES } from '../../infrastructure/queue/queue.names';
import { AUDIT, type AuditPort } from '../ports/audit.port';
import { INBOX, type InboxPort } from '../ports/inbox.port';
import {
  JOB_PUBLISHER,
  type JobPublisherPort,
} from '../ports/job-publisher.port';
import {
  KYC_SESSION_REPOSITORY,
  type KycSessionRepositoryPort,
} from '../ports/kyc.repository.port';
import type { DigioWebhookEnvelope } from '../integrations/digio-webhook.service';
import { POLL_JOB } from './kyc-status-poll.processor';
import { SIGNING_POLL_JOB } from './signing-status.processor';
import {
  isRegistryRegression,
  mapKraStatus,
} from '../../domain/account-opening/account-opening';
import {
  ACCOUNT_OPENING_REPOSITORY,
  type AccountOpeningRepositoryPort,
} from '../ports/account-opening.repository.port';
import { CLOCK, type ClockPort } from '../ports/clock.port';
import {
  SIGNING_REPOSITORY,
  type SigningRepositoryPort,
} from '../ports/signing.repository.port';

export interface WebhookJobPayload {
  inboxId: string;
}

/**
 * Processes an inbox row: KRA registration updates are retained for Phase 6; DigiStudio events trigger an
 * immediate status poll for the matching session (the payload itself is never trusted for completion).
 */
@Processor(QUEUES.WEBHOOKS)
export class DigioWebhookProcessor extends BaseProcessor<WebhookJobPayload> {
  private readonly logger: AppLogger;

  constructor(
    store: CorrelationStore,
    logger: AppLogger,
    @Inject(INBOX) private readonly inbox: InboxPort,
    @Inject(KYC_SESSION_REPOSITORY)
    private readonly sessions: KycSessionRepositoryPort,
    @Inject(JOB_PUBLISHER) private readonly jobs: JobPublisherPort,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(SIGNING_REPOSITORY) private readonly signing: SigningRepositoryPort,
    @Inject(ACCOUNT_OPENING_REPOSITORY)
    private readonly accounts: AccountOpeningRepositoryPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {
    super(store);
    this.logger = logger.child('DigioWebhookProcessor');
  }

  async handle(data: WebhookJobPayload): Promise<void> {
    const row = await this.inbox.get(data.inboxId);
    if (!row || row.status === 'PROCESSED') return;
    const body = row.payload as DigioWebhookEnvelope;
    try {
      const providerRequestId = findKycRequestId(body);
      if (providerRequestId) {
        const session =
          await this.sessions.findByProviderRequestId(providerRequestId);
        if (session) {
          await this.jobs.publish(
            QUEUES.KYC_STATUS,
            POLL_JOB,
            { sessionId: session.id },
            { jobId: `${session.id}-wh-${row.eventKey}` },
          );
          await this.audit.append({
            actorType: 'PARTNER',
            actorId: 'digio',
            action: 'webhook.kyc_session_event',
            aggregateType: 'application',
            aggregateId: session.applicationId,
            details: { event: body.event, providerRequestId },
          });
        } else {
          this.logger.warn('webhook.unknown_session', {
            event: body.event,
            providerRequestId,
          });
        }
      } else if (findSignDocumentId(body)) {
        const providerDocumentId = findSignDocumentId(body)!;
        const session =
          await this.signing.findByProviderRequestId(providerDocumentId);
        if (session) {
          await this.jobs.publish(
            QUEUES.SIGNING,
            SIGNING_POLL_JOB,
            { signingSessionId: session.id },
            { jobId: `${session.id}-wh-${row.eventKey}` },
          );
          await this.audit.append({
            actorType: 'PARTNER',
            actorId: 'digio',
            action: 'webhook.sign_event',
            aggregateType: 'application',
            aggregateId: session.applicationId,
            details: { event: body.event, providerDocumentId },
          });
        } else {
          this.logger.warn('webhook.unknown_sign_document', {
            event: body.event,
            providerDocumentId,
          });
        }
      } else if (body.entities?.includes('kra_register')) {
        await this.applyKraUpdate(body);
      } else {
        this.logger.info('webhook.unhandled', {
          event: body.event,
          entities: body.entities,
        });
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

  /** KRA.PAN.STATUS.UPDATE: correlate by request_id / client_reference_id; never regress a submission. */
  private async applyKraUpdate(body: DigioWebhookEnvelope): Promise<void> {
    const k = (body.payload?.kra_register ?? {}) as {
      request_id?: string;
      client_reference_id?: string;
      status?: string;
    };
    const submission = await this.accounts.findSubmissionByReference({
      providerRequestId: k.request_id,
      clientReferenceId: k.client_reference_id,
    });
    if (!submission) {
      this.logger.warn('webhook.kra_register_unknown', { event: body.event });
      return;
    }
    const next = mapKraStatus(k.status);
    const regression = isRegistryRegression(submission.status, next);
    if (!regression) {
      await this.accounts.updateSubmission({
        ...submission,
        status: next,
        lastProviderStatus: k.status,
        updatedAt: this.clock.now(),
      });
    }
    await this.audit.append({
      actorType: 'PARTNER',
      actorId: 'digio',
      action: regression
        ? 'webhook.kra_register_regression_ignored'
        : 'webhook.kra_register_applied',
      aggregateType: 'application',
      aggregateId: submission.applicationId,
      details: {
        submissionId: submission.id,
        from: submission.status,
        to: next,
      },
    });
  }
}

/** DigiSign document ids start with DID; look through every entity object for one. */
export function findSignDocumentId(
  body: DigioWebhookEnvelope,
): string | undefined {
  for (const value of Object.values(body.payload ?? {})) {
    if (value && typeof value === 'object') {
      const id = (value as { id?: unknown }).id;
      if (typeof id === 'string' && id.startsWith('DID')) return id;
    }
  }
  return undefined;
}

/** DigiStudio request ids start with KID; look through every entity object for one. */
export function findKycRequestId(
  body: DigioWebhookEnvelope,
): string | undefined {
  for (const value of Object.values(body.payload ?? {})) {
    if (value && typeof value === 'object') {
      const id = (value as { id?: unknown }).id;
      if (typeof id === 'string' && id.startsWith('KID')) return id;
    }
  }
  return undefined;
}

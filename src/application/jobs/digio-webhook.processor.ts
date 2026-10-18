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
      } else if (body.entities?.includes('kra_register')) {
        // Phase 6 consumes these; keep the inbox row as the durable record.
        this.logger.info('webhook.kra_register_received', {
          event: body.event,
        });
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

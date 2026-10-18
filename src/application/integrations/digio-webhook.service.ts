import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AppLogger } from '../../common/logging/logger.service';
import { INBOX, type InboxPort } from '../ports/inbox.port';
import {
  JOB_PUBLISHER,
  type JobPublisherPort,
} from '../ports/job-publisher.port';

export const DIGIO_WEBHOOK_QUEUE = 'webhook-processing';
export const DIGIO_WEBHOOK_JOB = 'digio';

export interface DigioWebhookEnvelope {
  id?: string;
  event?: string;
  entities?: string[];
  payload?: Record<string, unknown>;
}

/** Durable ingress: insert into the inbox (deduped by Digio's notification id), acknowledge, process in the worker. */
@Injectable()
export class DigioWebhookService {
  private readonly logger: AppLogger;

  constructor(
    @Inject(INBOX) private readonly inbox: InboxPort,
    @Inject(JOB_PUBLISHER) private readonly jobs: JobPublisherPort,
    logger: AppLogger,
  ) {
    this.logger = logger.child('DigioWebhookService');
  }

  async receive(
    body: DigioWebhookEnvelope,
    rawBody: Buffer | string,
  ): Promise<{ received: true; duplicate: boolean }> {
    const eventKey =
      typeof body.id === 'string' && body.id
        ? body.id
        : createHash('sha256').update(rawBody).digest('hex');
    const { inserted, id } = await this.inbox.insertIfNew(
      'digio',
      eventKey,
      body,
    );
    if (inserted) {
      await this.jobs.publish(
        DIGIO_WEBHOOK_QUEUE,
        DIGIO_WEBHOOK_JOB,
        { inboxId: id },
        { jobId: `inbox-${id}` },
      );
    } else {
      this.logger.info('webhook.duplicate', { provider: 'digio', eventKey });
    }
    return { received: true, duplicate: !inserted };
  }
}

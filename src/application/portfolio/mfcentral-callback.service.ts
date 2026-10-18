import { Inject, Injectable } from '@nestjs/common';
import { partnersConfig } from '../../common/config/partners.config';
import { AppLogger } from '../../common/logging/logger.service';
import { QUEUES } from '../../infrastructure/queue/queue.names';
import { INBOX, type InboxPort } from '../ports/inbox.port';
import {
  JOB_PUBLISHER,
  type JobPublisherPort,
} from '../ports/job-publisher.port';
import {
  PORTFOLIO_REPOSITORY,
  type PortfolioRepositoryPort,
} from '../ports/portfolio.repository.port';

export const PORTFOLIO_COMPLETE_JOB = 'complete';
export interface PortfolioCompletePayload {
  importId: string;
  inboxId: string;
}

/**
 * Durable ingress for what MF Central posts back to `redirectUrl`: match our import, store the payload once in
 * the inbox, queue the completion job and send the browser on to the front end. The payload is never trusted
 * here; the worker decides the outcome.
 */
@Injectable()
export class MfCentralCallbackService {
  private readonly logger: AppLogger;
  constructor(
    @Inject(PORTFOLIO_REPOSITORY)
    private readonly portfolio: PortfolioRepositoryPort,
    @Inject(INBOX) private readonly inbox: InboxPort,
    @Inject(JOB_PUBLISHER) private readonly jobs: JobPublisherPort,
    @Inject(partnersConfig.KEY)
    private readonly partners: ReturnType<typeof partnersConfig>,
    logger: AppLogger,
  ) {
    this.logger = logger.child('MfCentralCallbackService');
  }

  async receive(
    params: Record<string, unknown>,
  ): Promise<{ redirectTo: string; importId?: string; duplicate: boolean }> {
    const clientRefNo = str(params.clientRefNo) ?? str(params.clientrefno);
    const reqId = str(params.reqId) ?? str(params.reqid);
    const imp = clientRefNo
      ? await this.portfolio.findImportByClientRef(clientRefNo)
      : null;
    if (!imp) {
      this.logger.warn('mfcentral.callback.unknown', {
        hasClientRefNo: Boolean(clientRefNo),
        hasReqId: Boolean(reqId),
      });
      return {
        redirectTo: this.returnUrl({ status: 'unknown' }),
        duplicate: false,
      };
    }
    const { inserted, id } = await this.inbox.insertIfNew(
      'mfcentral',
      `cas-${imp.id}`,
      params,
    );
    if (inserted)
      await this.jobs.publish<PortfolioCompletePayload>(
        QUEUES.PORTFOLIO,
        PORTFOLIO_COMPLETE_JOB,
        { importId: imp.id, inboxId: id },
        { jobId: `inbox-${id}` },
      );
    else this.logger.info('mfcentral.callback.duplicate', { importId: imp.id });
    return {
      redirectTo: this.returnUrl({ import_id: imp.id, status: 'received' }),
      importId: imp.id,
      duplicate: !inserted,
    };
  }

  private returnUrl(query: Record<string, string>): string {
    const u = new URL(this.partners.mfcentral.returnUrl);
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    return u.toString();
  }
}
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

import { Inject, Injectable } from '@nestjs/common';
import type {
  AnalyticsSinkPort,
  AnalyticsUploadEvent,
  AnalyticsUploadResult,
} from '../../application/ports/analytics-outbox.port';
import { partnersConfig } from '../../common/config/partners.config';
import {
  DependencyUnavailableError,
  PartnerRejectedError,
} from '../../common/errors/app-error';
import { HttpClientService } from '../../common/http/http-client.service';
import { PartnerHttpError } from '../../common/http/partner-http.error';

export const CLEVERTAP_UPLOAD_PATH = '/1/upload';
export const CLEVERTAP_BATCH_MAX = 100;

interface UploadResponse {
  status?: string;
  processed?: number;
  unprocessed?: {
    status?: string;
    code?: number;
    error?: string;
    record?: Record<string, unknown>;
  }[];
}

/** CleverTap "Upload Events" API. Only allowlisted properties ever reach this class. */
@Injectable()
export class CleverTapGateway implements AnalyticsSinkPort {
  private readonly cfg: ReturnType<typeof partnersConfig>['clevertap'];
  constructor(
    private readonly http: HttpClientService,
    @Inject(partnersConfig.KEY) cfg: ReturnType<typeof partnersConfig>,
  ) {
    this.cfg = cfg.clevertap;
  }

  async upload(
    events: { id: string; event: AnalyticsUploadEvent }[],
  ): Promise<AnalyticsUploadResult> {
    const accepted: string[] = [];
    const rejected: { id: string; error: string }[] = [];
    for (let i = 0; i < events.length; i += CLEVERTAP_BATCH_MAX) {
      const batch = events.slice(i, i + CLEVERTAP_BATCH_MAX);
      let res;
      try {
        res = await this.http.request<UploadResponse>({
          partner: 'clevertap',
          operation: 'upload',
          method: 'POST',
          url: `${this.cfg.baseUrl}${CLEVERTAP_UPLOAD_PATH}`,
          body: { d: batch.map((b) => toRecord(b.event)) },
          responseType: 'json',
          headers: {
            'X-CleverTap-Account-Id': this.cfg.accountId,
            'X-CleverTap-Passcode': this.cfg.passcode,
          },
          timeoutMs: this.cfg.timeoutMs,
        });
      } catch (err) {
        if (
          err instanceof PartnerHttpError &&
          !err.isTransport &&
          err.status !== undefined &&
          err.status < 500
        )
          throw new PartnerRejectedError(
            'clevertap',
            err.vendorCode,
            undefined,
            { cause: err, details: { status: err.status } },
          );
        throw new DependencyUnavailableError(undefined, {
          cause: err,
          details: { partner: 'clevertap' },
        });
      }
      // CleverTap reports per-record failures by index into the batch it received.
      const failedByIndex = new Map<number, string>();
      for (const u of res.data.unprocessed ?? []) {
        const idx =
          typeof u.record?.['__index'] === 'number'
            ? u.record['__index']
            : Number(
                (
                  u.record?.['evtData'] as Record<string, unknown> | undefined
                )?.['__index'],
              );
        const evtId = (
          u.record?.['evtData'] as Record<string, unknown> | undefined
        )?.['event_id'];
        const match = batch.findIndex(
          (b, j) =>
            j === idx ||
            (evtId !== undefined && b.event.evtData['event_id'] === evtId),
        );
        if (match >= 0)
          failedByIndex.set(match, u.error ?? `code ${u.code ?? 'unknown'}`);
      }
      batch.forEach((b, j) =>
        failedByIndex.has(j)
          ? rejected.push({ id: b.id, error: failedByIndex.get(j)! })
          : accepted.push(b.id),
      );
    }
    return { accepted, rejected };
  }
}

function toRecord(e: AnalyticsUploadEvent): Record<string, unknown> {
  return {
    ...(e.identity ? { identity: e.identity } : { objectId: e.objectId }),
    type: 'event',
    evtName: e.evtName,
    ts: e.ts,
    evtData: e.evtData,
  };
}

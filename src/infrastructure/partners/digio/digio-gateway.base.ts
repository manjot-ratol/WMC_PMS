import { partnersConfig } from '../../../common/config/partners.config';
import {
  DependencyUnavailableError,
  PartnerRejectedError,
} from '../../../common/errors/app-error';
import { HttpClientService } from '../../../common/http/http-client.service';
import type {
  HttpRequestSpec,
  HttpResult,
} from '../../../common/http/http-request.types';
import { PartnerHttpError } from '../../../common/http/partner-http.error';

export type DigioConfig = ReturnType<typeof partnersConfig>['digio'];
export const DIGIO_REFERENCE_HEADER = 'X_REFERENCE_ID';

export interface DigioCallOptions {
  query?: HttpRequestSpec['query'];
  /** Sent as X_REFERENCE_ID; defaults to the correlation id. */
  referenceId?: string;
  responseType?: HttpRequestSpec['responseType'];
  bodyType?: HttpRequestSpec['bodyType'];
}

/** Shared plumbing for every Digio gateway: base URL, Basic auth, reference header, error translation. */
export abstract class DigioGatewayBase {
  protected constructor(
    protected readonly http: HttpClientService,
    protected readonly config: DigioConfig,
  ) {}

  protected async post<T>(
    operation: string,
    path: string,
    body: unknown,
    opts: DigioCallOptions = {},
  ): Promise<HttpResult<T>> {
    try {
      return await this.http.request<T>({
        partner: 'digio',
        operation,
        method: 'POST',
        url: `${this.config.baseUrl}${path}`,
        body,
        bodyType: opts.bodyType,
        query: opts.query,
        responseType: opts.responseType ?? 'json',
        auth: {
          type: 'basic',
          username: this.config.clientId,
          password: this.config.clientSecret,
        },
        headers: opts.referenceId
          ? { [DIGIO_REFERENCE_HEADER]: opts.referenceId }
          : undefined,
        vendorReferenceHeader: opts.referenceId
          ? undefined
          : DIGIO_REFERENCE_HEADER,
        timeoutMs: this.config.timeoutMs,
      });
    } catch (err) {
      throw translateDigioError(err, operation);
    }
  }
}

export function translateDigioError(err: unknown, operation: string): Error {
  if (!(err instanceof PartnerHttpError))
    return err instanceof Error ? err : new Error(String(err));
  if (err.isTransport || (err.status !== undefined && err.status >= 500)) {
    return new DependencyUnavailableError(undefined, {
      cause: err,
      details: { partner: 'digio', operation, status: err.status },
    });
  }
  const body = err.body as { message?: string; details?: string } | undefined;
  return new PartnerRejectedError('digio', err.vendorCode, undefined, {
    cause: err,
    details: {
      operation,
      status: err.status,
      vendorCode: err.vendorCode,
      vendorMessage: body?.message,
      vendorDetails: body?.details,
    },
  });
}

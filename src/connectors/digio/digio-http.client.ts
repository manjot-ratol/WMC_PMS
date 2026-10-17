import { HttpService } from '@nestjs/axios';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { AxiosError, type AxiosRequestConfig } from 'axios';
import { firstValueFrom } from 'rxjs';
import { digioConfig } from '../../config/digio.config';
import { DigioApiError, DigioErrorBody } from './digio.errors';

export interface DigioRequestOptions {
  /** Sent as the X_REFERENCE_ID header for traceability on Digio's side. */
  referenceId?: string;
  query?: Record<string, string | number | boolean | undefined>;
}

/**
 * Thin HTTP layer shared by every Digio connector: base URL, Basic auth,
 * timeout, X_REFERENCE_ID header and uniform error mapping.
 */
@Injectable()
export class DigioHttpClient {
  private readonly logger = new Logger(DigioHttpClient.name);
  private readonly authorizationHeader: string;

  constructor(
    private readonly http: HttpService,
    @Inject(digioConfig.KEY)
    private readonly config: ConfigType<typeof digioConfig>,
  ) {
    const credentials = Buffer.from(
      `${config.clientId}:${config.clientSecret}`,
      'utf8',
    ).toString('base64');
    this.authorizationHeader = `Basic ${credentials}`;
  }

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  async post<TResponse, TBody = unknown>(
    path: string,
    body: TBody,
    options: DigioRequestOptions = {},
  ): Promise<TResponse> {
    const headers: Record<string, string> = {
      Authorization: this.authorizationHeader,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (options.referenceId) {
      headers['X_REFERENCE_ID'] = options.referenceId;
    }

    const requestConfig: AxiosRequestConfig = {
      headers,
      timeout: this.config.timeoutMs,
      params: stripUndefined(options.query),
    };

    const url = `${this.config.baseUrl}${path}`;
    try {
      const response = await firstValueFrom(
        this.http.post<TResponse>(url, body, requestConfig),
      );
      return response.data;
    } catch (err) {
      throw this.toDigioError(err, path, options.referenceId);
    }
  }

  private toDigioError(
    err: unknown,
    path: string,
    referenceId: string | undefined,
  ): DigioApiError {
    if (err instanceof DigioApiError) return err;

    const axiosError = err as AxiosError<DigioErrorBody>;
    if (axiosError && axiosError.isAxiosError) {
      const status = axiosError.response?.status;
      const data = axiosError.response?.data;
      const parsed = isErrorBody(data) ? data : undefined;
      const message = status
        ? `Digio ${path} failed with HTTP ${status}: ${parsed?.message ?? axiosError.message}`
        : `Digio ${path} request failed: ${axiosError.message}`;
      this.logger.warn(
        `${message}${referenceId ? ` (reference ${referenceId})` : ''}`,
      );
      return new DigioApiError(
        message,
        status,
        parsed?.code ?? axiosError.code,
        parsed?.details,
        data,
        referenceId,
        path,
      );
    }

    const message =
      err instanceof Error ? err.message : 'Unknown error calling Digio';
    return new DigioApiError(
      `Digio ${path} request failed: ${message}`,
      undefined,
      undefined,
      undefined,
      undefined,
      referenceId,
      path,
    );
  }
}

function isErrorBody(data: unknown): data is DigioErrorBody {
  return typeof data === 'object' && data !== null;
}

function stripUndefined(
  query: DigioRequestOptions['query'],
): Record<string, string | number | boolean> | undefined {
  if (!query) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

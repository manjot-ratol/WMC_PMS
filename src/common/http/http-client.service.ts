import { Inject, Injectable } from '@nestjs/common';
import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import { CORRELATION_HEADER } from '../correlation/correlation.constants';
import { CorrelationStore } from '../correlation/correlation.store';
import { DependencyUnavailableError } from '../errors/app-error';
import { AppLogger } from '../logging/logger.service';
import { CircuitBreakerRegistry } from './circuit-breaker.registry';
import {
  HttpRequestSpec,
  HttpResult,
  PARTNER_TIMEOUTS,
  PartnerTimeouts,
} from './http-request.types';
import { PartnerHttpError } from './partner-http.error';
import { withRetry } from './retry.policy';

/**
 * The single outbound HTTP connector. Partner gateways describe a request; this service adds
 * correlation headers, auth, timeout, retry, circuit breaking, logging and uniform error mapping.
 */
@Injectable()
export class HttpClientService {
  private readonly logger: AppLogger;

  constructor(
    private readonly store: CorrelationStore,
    logger: AppLogger,
    private readonly breakers: CircuitBreakerRegistry,
    @Inject(PARTNER_TIMEOUTS) private readonly timeouts: PartnerTimeouts,
  ) {
    this.logger = logger.child('HttpClient');
  }

  async request<T>(spec: HttpRequestSpec): Promise<HttpResult<T>> {
    const run = () => this.once<T>(spec);
    const guarded = () =>
      this.breakers.get(spec.partner).fire(run) as Promise<HttpResult<T>>;
    try {
      return spec.retry
        ? await withRetry(guarded, spec.retry)
        : await guarded();
    } catch (err) {
      if (isBreakerOpen(err)) {
        this.logger.warn('http.outbound.breaker_open', {
          partner: spec.partner,
          operation: spec.operation,
        });
        throw new DependencyUnavailableError(undefined, {
          cause: err,
          details: { partner: spec.partner, operation: spec.operation },
        });
      }
      throw err;
    }
  }

  private async once<T>(spec: HttpRequestSpec): Promise<HttpResult<T>> {
    const started = Date.now();
    const config = this.toAxiosConfig(spec);
    try {
      const res = await axios.request<T>(config);
      const result = this.toResult<T>(spec, res, started);
      this.logger.info('http.outbound', {
        partner: spec.partner,
        operation: spec.operation,
        status: res.status,
        durationMs: result.durationMs,
      });
      return result;
    } catch (err) {
      const mapped =
        err instanceof PartnerHttpError ? err : this.toPartnerError(spec, err);
      this.logger.warn('http.outbound', {
        partner: spec.partner,
        operation: spec.operation,
        status: mapped.status,
        vendorCode: mapped.vendorCode,
        transport: mapped.isTransport,
        durationMs: Date.now() - started,
        error: mapped.message,
      });
      throw mapped;
    }
  }

  private toAxiosConfig(spec: HttpRequestSpec): AxiosRequestConfig {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...spec.headers,
    };
    const correlationId = this.store.getCorrelationId();
    headers[CORRELATION_HEADER] = correlationId;
    if (spec.vendorReferenceHeader)
      headers[spec.vendorReferenceHeader] = correlationId;
    if (spec.auth?.type === 'basic')
      headers.Authorization =
        'Basic ' +
        Buffer.from(`${spec.auth.username}:${spec.auth.password}`).toString(
          'base64',
        );
    if (spec.auth?.type === 'bearer')
      headers.Authorization = `Bearer ${spec.auth.token}`;

    let data: unknown = spec.body;
    switch (spec.bodyType ?? 'json') {
      case 'json':
        if (data !== undefined) headers['Content-Type'] = 'application/json';
        break;
      case 'form':
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        data = new URLSearchParams(
          Object.entries((spec.body ?? {}) as Record<string, string>),
        ).toString();
        break;
      case 'text':
        headers['Content-Type'] = 'text/plain';
        break;
      case 'multipart':
        // axios sets the boundary when given FormData
        break;
    }

    return {
      method: spec.method,
      url: spec.url,
      headers,
      params: stripUndefined(spec.query),
      data,
      timeout: spec.timeoutMs ?? this.timeouts[spec.partner],
      responseType:
        spec.responseType === 'arraybuffer'
          ? 'arraybuffer'
          : spec.responseType === 'text'
            ? 'text'
            : 'json',
      // Parse JSON ourselves so a non-JSON 200 becomes a typed failure rather than a string.
      transformResponse:
        spec.responseType === 'arraybuffer' || spec.responseType === 'text'
          ? undefined
          : [(d: unknown) => d],
      validateStatus: () => true,
      maxContentLength: 25 * 1024 * 1024,
    };
  }

  private toResult<T>(
    spec: HttpRequestSpec,
    res: AxiosResponse,
    started: number,
  ): HttpResult<T> {
    const headers = Object.fromEntries(
      Object.entries(res.headers).map(([k, v]) => [k.toLowerCase(), String(v)]),
    );
    const responseType = spec.responseType ?? 'json';
    let data: unknown = res.data;
    if (responseType === 'json') data = parseJson(spec, res);
    else if (responseType === 'arraybuffer')
      data = Buffer.isBuffer(res.data)
        ? res.data
        : Buffer.from(res.data as ArrayBuffer);

    if (res.status >= 400) {
      const body = responseType === 'json' ? data : undefined;
      throw new PartnerHttpError({
        partner: spec.partner,
        operation: spec.operation,
        status: res.status,
        body,
        vendorCode: vendorCodeOf(body),
        message: `${spec.partner} ${spec.operation} failed with HTTP ${res.status}`,
      });
    }
    return {
      status: res.status,
      headers,
      data: data as T,
      durationMs: Date.now() - started,
    };
  }

  private toPartnerError(
    spec: HttpRequestSpec,
    err: unknown,
  ): PartnerHttpError {
    const ax = err as AxiosError;
    const message = ax?.message ?? String(err);
    return new PartnerHttpError({
      partner: spec.partner,
      operation: spec.operation,
      isTransport: true,
      cause: err,
      vendorCode: ax?.code,
      message: `${spec.partner} ${spec.operation} transport failure: ${message}`,
    });
  }
}

function parseJson(spec: HttpRequestSpec, res: AxiosResponse): unknown {
  const raw = res.data as unknown;
  if (raw === '' || raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    if (res.status >= 400) return { raw: raw.slice(0, 500) };
    throw new PartnerHttpError({
      partner: spec.partner,
      operation: spec.operation,
      status: res.status,
      vendorCode: 'INVALID_RESPONSE',
      retryable: false,
      message: `${spec.partner} ${spec.operation} returned a non-JSON body with HTTP ${res.status}`,
    });
  }
}

function vendorCodeOf(body: unknown): string | undefined {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    for (const k of ['code', 'error_code', 'errorCode', 'error']) {
      if (typeof b[k] === 'string') return b[k];
    }
  }
  return undefined;
}

function stripUndefined(
  q?: HttpRequestSpec['query'],
): Record<string, string | number | boolean> | undefined {
  if (!q) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(q)) if (v !== undefined) out[k] = v;
  return Object.keys(out).length ? out : undefined;
}

function isBreakerOpen(err: unknown): boolean {
  return (err as { code?: string } | undefined)?.code === 'EOPENBREAKER';
}

import { HttpService } from '@nestjs/axios';
import {
  AxiosError,
  AxiosHeaders,
  AxiosRequestConfig,
  AxiosResponse,
} from 'axios';
import { of, throwError } from 'rxjs';
import { DigioConfig } from '../../config/digio.config';
import { DigioHttpClient } from './digio-http.client';
import { DigioApiError } from './digio.errors';

const config: DigioConfig = {
  baseUrl: 'https://ext.digio.in:444',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  timeoutMs: 1234,
};

function axiosResponse<T>(data: T, status = 200): AxiosResponse<T> {
  return {
    data,
    status,
    statusText: 'OK',
    headers: {},
    config: { headers: new AxiosHeaders() },
  };
}

function axiosError(status: number | undefined, data?: unknown): AxiosError {
  const err = new AxiosError(
    status
      ? `Request failed with status code ${status}`
      : 'timeout of 1234ms exceeded',
    status ? 'ERR_BAD_REQUEST' : 'ECONNABORTED',
    { headers: new AxiosHeaders() },
    undefined,
    status
      ? {
          data,
          status,
          statusText: '',
          headers: {},
          config: { headers: new AxiosHeaders() },
        }
      : undefined,
  );
  return err;
}

type PostCall = [
  string,
  unknown,
  AxiosRequestConfig & { headers: Record<string, string> },
];

describe('DigioHttpClient', () => {
  let post: jest.Mock<unknown, PostCall>;
  let client: DigioHttpClient;

  beforeEach(() => {
    post = jest.fn<unknown, PostCall>();
    client = new DigioHttpClient({ post } as unknown as HttpService, config);
  });

  it('posts JSON to baseUrl + path with Basic auth and timeout', async () => {
    post.mockReturnValue(of(axiosResponse({ ok: true })));

    const result = await client.post<{ ok: boolean }>('/v3/x', { a: 1 });

    expect(result).toEqual({ ok: true });
    expect(post).toHaveBeenCalledTimes(1);
    const [url, body, cfg] = post.mock.calls[0];
    expect(url).toBe('https://ext.digio.in:444/v3/x');
    expect(body).toEqual({ a: 1 });
    expect(cfg.timeout).toBe(1234);
    expect(cfg.headers.Authorization).toBe(
      'Basic ' + Buffer.from('client-id:client-secret').toString('base64'),
    );
    expect(cfg.headers['Content-Type']).toBe('application/json');
    expect(cfg.headers['X_REFERENCE_ID']).toBeUndefined();
    expect(cfg.params).toBeUndefined();
  });

  it('sends X_REFERENCE_ID header and query params when provided', async () => {
    post.mockReturnValue(of(axiosResponse({})));

    await client.post(
      '/v3/x',
      {},
      {
        referenceId: 'ref-1',
        query: { deserialize_codes: true, skip: undefined },
      },
    );

    const cfg = post.mock.calls[0][2];
    expect(cfg.headers['X_REFERENCE_ID']).toBe('ref-1');
    expect(cfg.params).toEqual({ deserialize_codes: true });
  });

  it('maps a 400 with Digio error body to DigioApiError', async () => {
    post.mockReturnValue(
      throwError(() =>
        axiosError(400, {
          details: 'EX23297402937402',
          code: 'REQUEST_VALIDATION_FAILED',
          message: 'Request Validation Failed',
        }),
      ),
    );

    const err = await client
      .post('/v3/x', {}, { referenceId: 'ref-2' })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DigioApiError);
    const digioErr = err as DigioApiError;
    expect(digioErr.httpStatus).toBe(400);
    expect(digioErr.code).toBe('REQUEST_VALIDATION_FAILED');
    expect(digioErr.details).toBe('EX23297402937402');
    expect(digioErr.referenceId).toBe('ref-2');
    expect(digioErr.path).toBe('/v3/x');
    expect(digioErr.isTransportError).toBe(false);
    expect(digioErr.message).toContain('HTTP 400');
    expect(digioErr.message).toContain('Request Validation Failed');
  });

  it('maps a transport failure (no response) to DigioApiError with no status', async () => {
    post.mockReturnValue(throwError(() => axiosError(undefined)));

    const err = await client.post('/v3/x', {}).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DigioApiError);
    const digioErr = err as DigioApiError;
    expect(digioErr.httpStatus).toBeUndefined();
    expect(digioErr.isTransportError).toBe(true);
    expect(digioErr.code).toBe('ECONNABORTED');
  });
});

import nock from 'nock';
import { CorrelationStore } from '../correlation/correlation.store';
import { DependencyUnavailableError } from '../errors/app-error';
import { CircuitBreakerRegistry } from './circuit-breaker.registry';
import { HttpClientService } from './http-client.service';
import { PartnerHttpError } from './partner-http.error';

const BASE = 'http://partner.test';

describe('HttpClientService', () => {
  const store = new CorrelationStore();
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  };
  logger.child.mockReturnValue(logger);
  const timeouts = {
    digio: 500,
    trackwizz: 500,
    mfcentral: 500,
    ignosis: 500,
    clevertap: 500,
    messaging: 500,
  };
  let breakers: CircuitBreakerRegistry;
  let client: HttpClientService;

  beforeEach(() => {
    nock.cleanAll();
    breakers = new CircuitBreakerRegistry({
      errorThresholdPercentage: 50,
      resetTimeoutMs: 100000,
      volumeThreshold: 2,
      rollingWindowMs: 10000,
    });
    client = new HttpClientService(store, logger as never, breakers, timeouts);
    jest.clearAllMocks();
  });
  afterAll(() => nock.restore());

  const inCtx = <T>(fn: () => Promise<T>) =>
    store.run({ correlationId: 'corr-9', requestId: 'r' }, fn);

  it('sends correlation and vendor reference headers, basic auth and JSON body', async () => {
    const scope = nock(BASE, {
      reqheaders: {
        'x-correlation-id': 'corr-9',
        x_reference_id: 'corr-9',
        authorization: 'Basic ' + Buffer.from('u:p').toString('base64'),
        'content-type': /application\/json/,
      },
    })
      .post('/v3/x', { a: 1 })
      .query({ q: 'true' })
      .reply(200, { ok: true });

    const res = await inCtx(() =>
      client.request<{ ok: boolean }>({
        partner: 'digio',
        operation: 'x.op',
        method: 'POST',
        url: `${BASE}/v3/x`,
        body: { a: 1 },
        query: { q: true, skip: undefined },
        auth: { type: 'basic', username: 'u', password: 'p' },
        vendorReferenceHeader: 'X_REFERENCE_ID',
      }),
    );
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ ok: true });
    expect(typeof res.durationMs).toBe('number');
    expect(scope.isDone()).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      'http.outbound',
      expect.objectContaining({
        partner: 'digio',
        operation: 'x.op',
        status: 200,
      }),
    );
    expect(JSON.stringify(logger.info.mock.calls as unknown[])).not.toContain(
      '"a":1',
    );
  });

  it('maps a 400 JSON body to PartnerHttpError with vendorCode and not retryable', async () => {
    nock(BASE).post('/v3/x').reply(400, {
      code: 'REQUEST_VALIDATION_FAILED',
      message: 'bad',
      details: 'EX1',
    });
    const err = await client
      .request({
        partner: 'digio',
        operation: 'x',
        method: 'POST',
        url: `${BASE}/v3/x`,
        body: {},
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PartnerHttpError);
    const e = err as PartnerHttpError;
    expect(e.status).toBe(400);
    expect(e.vendorCode).toBe('REQUEST_VALIDATION_FAILED');
    expect(e.retryable).toBe(false);
    expect(e.isTransport).toBe(false);
    expect(e.body).toEqual({
      code: 'REQUEST_VALIDATION_FAILED',
      message: 'bad',
      details: 'EX1',
    });
  });

  it('retries on 503 then succeeds', async () => {
    nock(BASE).get('/r').reply(503, 'down').get('/r').reply(200, { fine: 1 });
    const res = await client.request({
      partner: 'digio',
      operation: 'r',
      method: 'GET',
      url: `${BASE}/r`,
      retry: { attempts: 3, backoffMs: 1 },
    });
    expect(res.data).toEqual({ fine: 1 });
  });

  it('does not retry 4xx even with a retry policy', async () => {
    const scope = nock(BASE).get('/r').reply(404, {});
    await expect(
      client.request({
        partner: 'digio',
        operation: 'r',
        method: 'GET',
        url: `${BASE}/r`,
        retry: { attempts: 3, backoffMs: 1 },
      }),
    ).rejects.toBeInstanceOf(PartnerHttpError);
    expect(scope.isDone()).toBe(true);
    expect(nock.pendingMocks()).toHaveLength(0);
  });

  it('maps a timeout to a retryable transport error', async () => {
    nock(BASE).get('/slow').delayConnection(800).reply(200, {});
    const err = (await client
      .request({
        partner: 'digio',
        operation: 'slow',
        method: 'GET',
        url: `${BASE}/slow`,
        timeoutMs: 50,
      })
      .catch((e: unknown) => e)) as PartnerHttpError;
    expect(err).toBeInstanceOf(PartnerHttpError);
    expect(err.isTransport).toBe(true);
    expect(err.retryable).toBe(true);
    expect(err.status).toBeUndefined();
  });

  it('treats a non-JSON 200 as INVALID_RESPONSE, not retryable', async () => {
    nock(BASE)
      .get('/html')
      .reply(200, '<html>oops</html>', { 'content-type': 'text/html' });
    const err = (await client
      .request({
        partner: 'digio',
        operation: 'html',
        method: 'GET',
        url: `${BASE}/html`,
        responseType: 'json',
      })
      .catch((e: unknown) => e)) as PartnerHttpError;
    expect(err).toBeInstanceOf(PartnerHttpError);
    expect(err.vendorCode).toBe('INVALID_RESPONSE');
    expect(err.retryable).toBe(false);
  });

  it('returns a Buffer for arraybuffer responses', async () => {
    nock(BASE)
      .get('/zip')
      .reply(200, Buffer.from([1, 2, 3]), {
        'content-type': 'application/octet-stream',
      });
    const res = await client.request<Buffer>({
      partner: 'digio',
      operation: 'zip',
      method: 'GET',
      url: `${BASE}/zip`,
      responseType: 'arraybuffer',
    });
    expect(Buffer.isBuffer(res.data)).toBe(true);
    expect(res.headers['content-type']).toBe('application/octet-stream');
  });

  it('sends form bodies urlencoded and bearer auth', async () => {
    const scope = nock(BASE, {
      reqheaders: {
        authorization: 'Bearer tok',
        'content-type': /x-www-form-urlencoded/,
      },
    })
      .post('/token', 'grant_type=password&username=u')
      .reply(200, {});
    await client.request({
      partner: 'mfcentral',
      operation: 't',
      method: 'POST',
      url: `${BASE}/token`,
      bodyType: 'form',
      body: { grant_type: 'password', username: 'u' },
      auth: { type: 'bearer', token: 'tok' },
    });
    expect(scope.isDone()).toBe(true);
  });

  it('sends text bodies and multipart bodies as given', async () => {
    const scope = nock(BASE, { reqheaders: { 'content-type': /text\/plain/ } })
      .post('/t', 'raw-text')
      .reply(200, 'ok', { 'content-type': 'text/plain' });
    const res = await client.request<string>({
      partner: 'mfcentral',
      operation: 't',
      method: 'POST',
      url: `${BASE}/t`,
      bodyType: 'text',
      body: 'raw-text',
      responseType: 'text',
    });
    expect(res.data).toBe('ok');
    expect(scope.isDone()).toBe(true);
    const form = new FormData();
    form.append('a', '1');
    nock(BASE).post('/m').reply(200, {});
    await expect(
      client.request({
        partner: 'digio',
        operation: 'm',
        method: 'POST',
        url: `${BASE}/m`,
        bodyType: 'multipart',
        body: form,
      }),
    ).resolves.toMatchObject({ status: 200 });
  });

  it('returns undefined data for an empty 200 body and wraps a non-JSON error body', async () => {
    nock(BASE).get('/empty').reply(200, '');
    const res = await client.request({
      partner: 'digio',
      operation: 'e',
      method: 'GET',
      url: `${BASE}/empty`,
    });
    expect(res.data).toBeUndefined();
    nock(BASE)
      .get('/html500')
      .reply(500, '<html>boom</html>', { 'content-type': 'text/html' });
    const err = (await client
      .request({
        partner: 'digio',
        operation: 'h',
        method: 'GET',
        url: `${BASE}/html500`,
      })
      .catch((e: unknown) => e)) as PartnerHttpError;
    expect(err.status).toBe(500);
    expect(err.body).toEqual({ raw: '<html>boom</html>' });
    expect(err.vendorCode).toBeUndefined();
  });

  it('error bodies are omitted for non-JSON response types and transport errors keep a message', async () => {
    nock(BASE).get('/bin404').reply(404, Buffer.from('nope'), {
      'content-type': 'application/octet-stream',
    });
    const err = (await client
      .request({
        partner: 'digio',
        operation: 'b',
        method: 'GET',
        url: `${BASE}/bin404`,
        responseType: 'arraybuffer',
      })
      .catch((e: unknown) => e)) as PartnerHttpError;
    expect(err.status).toBe(404);
    expect(err.body).toBeUndefined();
    nock(BASE)
      .get('/txt500')
      .reply(500, 'oops', { 'content-type': 'text/plain' });
    const txt = (await client
      .request({
        partner: 'digio',
        operation: 't',
        method: 'GET',
        url: `${BASE}/txt500`,
        responseType: 'text',
      })
      .catch((e: unknown) => e)) as PartnerHttpError;
    expect(txt.status).toBe(500);
    nock(BASE)
      .get('/reset')
      .replyWithError({ message: 'socket hang up', code: 'ECONNRESET' });
    const net = (await client
      .request({
        partner: 'digio',
        operation: 'n',
        method: 'GET',
        url: `${BASE}/reset`,
      })
      .catch((e: unknown) => e)) as PartnerHttpError;
    expect(net.isTransport).toBe(true);
    expect(net.message).toContain('socket hang up');
  });

  it('accepts an explicit auth none and pre-parsed JSON objects', async () => {
    nock(BASE).get('/none').reply(200, { ok: 1 });
    const res = await client.request<{ ok: number }>({
      partner: 'digio',
      operation: 'none',
      method: 'GET',
      url: `${BASE}/none`,
      auth: { type: 'none' },
    });
    expect(res.data).toEqual({ ok: 1 });
  });

  it('takes vendor codes from error_code / errorCode / error keys', async () => {
    for (const body of [
      { error_code: 'A' },
      { errorCode: 'B' },
      { error: 'C' },
      { nothing: 1 },
    ]) {
      nock(BASE).get('/vc').reply(400, body);
      const err = (await client
        .request({
          partner: 'digio',
          operation: 'vc',
          method: 'GET',
          url: `${BASE}/vc`,
        })
        .catch((e: unknown) => e)) as PartnerHttpError;
      expect(err.vendorCode).toBe(
        (body as Record<string, string>).error_code ??
          (body as Record<string, string>).errorCode ??
          (body as Record<string, string>).error,
      );
    }
  });

  it('opens the breaker after repeated failures and fails fast', async () => {
    nock(BASE).get('/f').times(2).reply(503, {});
    await client
      .request({
        partner: 'trackwizz',
        operation: 'f',
        method: 'GET',
        url: `${BASE}/f`,
      })
      .catch(() => undefined);
    await client
      .request({
        partner: 'trackwizz',
        operation: 'f',
        method: 'GET',
        url: `${BASE}/f`,
      })
      .catch(() => undefined);
    const err = await client
      .request({
        partner: 'trackwizz',
        operation: 'f',
        method: 'GET',
        url: `${BASE}/f`,
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DependencyUnavailableError);
    expect(nock.pendingMocks()).toHaveLength(0);
  });

  it('4xx responses do not trip the breaker', async () => {
    nock(BASE).get('/c').times(3).reply(422, {});
    for (let i = 0; i < 3; i++)
      await client
        .request({
          partner: 'clevertap',
          operation: 'c',
          method: 'GET',
          url: `${BASE}/c`,
        })
        .catch(() => undefined);
    expect(breakers.get('clevertap').opened).toBe(false);
  });
});

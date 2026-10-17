import {
  KRA_GATEWAY,
  type KraGatewayPort,
} from '../../src/application/ports/kra-gateway.port';
import {
  DependencyUnavailableError,
  PartnerRejectedError,
} from '../../src/common/errors/app-error';
import { CorrelationStore } from '../../src/common/correlation/correlation.store';
import { startSitApp, type SitApp } from './setup/test-app';
import { wiremock } from './setup/wiremock';

describe('SIT: platform', () => {
  let sit: SitApp;

  beforeAll(async () => {
    sit = await startSitApp();
  });
  afterAll(() => sit.stop());
  beforeEach(() => wiremock.reset());

  it('health/ready is 200 with live infra', async () => {
    const res = await sit.http().get('/health/ready').expect(200);
    expect(res.body).toEqual({
      status: 'ok',
      checks: { postgres: 'ok', redis: 'ok' },
    });
  });

  it('unknown route returns the envelope with request_id equal to the sent X-Correlation-ID', async () => {
    const res = await sit
      .http()
      .get('/does-not-exist')
      .set('X-Correlation-ID', 'sit-corr-1')
      .expect(404);
    expect(res.headers['x-correlation-id']).toBe('sit-corr-1');
    expect(res.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: expect.any(String) as string,
        retryable: false,
      },
      request_id: 'sit-corr-1',
    });
  });

  it('replaces an invalid correlation header with a generated one', async () => {
    const res = await sit
      .http()
      .get('/health')
      .set('X-Correlation-ID', 'has spaces in it')
      .expect(200);
    expect(res.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('every log line of a request carries the request correlation id', async () => {
    sit.logs.length = 0;
    await sit
      .http()
      .get('/health')
      .set('X-Correlation-ID', 'sit-log-9')
      .expect(200);
    const mine = sit.logs.filter((l) => l.correlationId === 'sit-log-9');
    expect(mine.length).toBeGreaterThanOrEqual(1);
    expect(
      mine.some((l) => l.msg === 'http.request' && l.route === '/health'),
    ).toBe(true);
    expect(
      sit.logs
        .filter((l) => l.msg === 'http.request')
        .every((l) => typeof l.correlationId === 'string'),
    ).toBe(true);
  });

  describe('Digio KRA gateway through WireMock', () => {
    let kra: KraGatewayPort;
    let store: CorrelationStore;
    beforeAll(() => {
      kra = sit.app.get<KraGatewayPort>(KRA_GATEWAY);
      store = sit.app.get(CorrelationStore);
    });

    it('returns the mapped status and sends auth + reference headers', async () => {
      const out = await store.run(
        { correlationId: 'sit-kra-1', requestId: 'r' },
        () =>
          kra.checkPanStatus({
            pan: 'ABJPM6976J',
            fetchType: 'I',
            uniqueRequestId: 'uniq-sit-1',
          }),
      );
      expect(out).toMatchObject({
        pan: 'ABJPM6976J',
        statusCode: '007',
        status: 'Validated',
        statusDate: '2023-06-02',
      });
      const calls = await wiremock.requestsTo(
        '/digio/v3/client/kyc/kra/v2/get_pan_status',
      );
      expect(calls).toHaveLength(1);
      expect(calls[0].headers['X_REFERENCE_ID']).toBe('uniq-sit-1');
      expect(calls[0].headers['X-Correlation-ID']).toBe('sit-kra-1');
      expect(calls[0].headers.Authorization).toBe(
        'Basic ' + Buffer.from('sit-client:sit-secret').toString('base64'),
      );
    });

    it('maps a 503 to DependencyUnavailableError and a 400 to PartnerRejectedError', async () => {
      await expect(
        kra.checkPanStatus({ pan: 'DOWNX0000X', uniqueRequestId: 'u' }),
      ).rejects.toBeInstanceOf(DependencyUnavailableError);
      await expect(
        kra.checkPanStatus({ pan: 'BADPN0000X', uniqueRequestId: 'u' }),
      ).rejects.toBeInstanceOf(PartnerRejectedError);
    });
  });
});

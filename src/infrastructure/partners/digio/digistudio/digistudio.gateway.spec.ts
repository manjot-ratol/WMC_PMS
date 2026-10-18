import nock from 'nock';
import { CorrelationStore } from '../../../../common/correlation/correlation.store';
import {
  DependencyUnavailableError,
  PartnerRejectedError,
} from '../../../../common/errors/app-error';
import { CircuitBreakerRegistry } from '../../../../common/http/circuit-breaker.registry';
import { HttpClientService } from '../../../../common/http/http-client.service';
import { DIGISTUDIO_PATHS, DigiStudioGateway } from './digistudio.gateway';
import { fromStatusResponse, redactForEvidence } from './digistudio.mapper';

const BASE = 'http://digio.test';
const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  child: jest.fn(),
};
logger.child.mockReturnValue(logger);
const http = new HttpClientService(
  new CorrelationStore(),
  logger as never,
  new CircuitBreakerRegistry({
    errorThresholdPercentage: 100,
    resetTimeoutMs: 1000,
    volumeThreshold: 1000,
    rollingWindowMs: 1000,
  }),
  {
    digio: 1000,
    trackwizz: 1000,
    mfcentral: 1000,
    ignosis: 1000,
    clevertap: 1000,
    messaging: 1000,
  },
);
const gateway = new DigiStudioGateway(http, {
  digio: {
    baseUrl: BASE,
    clientId: 'c',
    clientSecret: 's',
    timeoutMs: 1000,
    webhookSecret: '',
  },
} as never);

describe('DigiStudioGateway', () => {
  beforeEach(() => nock.cleanAll());
  afterAll(() => nock.restore());

  it('creates a request with the template, no notification, access token, and strips the token from evidence', async () => {
    nock(BASE, { reqheaders: { x_reference_id: 'ks_1' } })
      .post(
        DIGISTUDIO_PATHS.createWithTemplate,
        (b: Record<string, unknown>) =>
          b.template_name === 'PMS_KYC' &&
          b.notify_customer === false &&
          b.generate_access_token === true &&
          b.reference_id === 'app_1' &&
          b.transaction_id === 'ks_1',
      )
      .reply(200, {
        id: 'KID1',
        status: 'requested',
        access_token: { id: 'GWT1', valid_till: '2026-10-19 08:51:19' },
        actions: [{ id: 'a1', otp: '1234' }],
      });
    const out = await gateway.createRequest({
      customerIdentifier: '919000000001',
      referenceId: 'app_1',
      transactionId: 'ks_1',
      templateName: 'PMS_KYC',
    });
    expect(out).toMatchObject({
      providerRequestId: 'KID1',
      status: 'requested',
      accessToken: { id: 'GWT1' },
    });
    expect(JSON.stringify(out.raw)).not.toContain('GWT1');
    expect(JSON.stringify(out.raw)).not.toContain('1234');
  });

  it('rejects a create response without an id', async () => {
    nock(BASE)
      .post(DIGISTUDIO_PATHS.createWithTemplate)
      .reply(200, { status: 'requested' });
    await expect(
      gateway.createRequest({
        customerIdentifier: 'x',
        referenceId: 'a',
        transactionId: 't',
        templateName: 'T',
      }),
    ).rejects.toBeInstanceOf(PartnerRejectedError);
  });

  it('reads status with detail_response and maps actions, handling the request_details wrapper', async () => {
    nock(BASE)
      .post(DIGISTUDIO_PATHS.status('KID1'))
      .query({ detail_response: 'true' })
      .reply(200, {
        id: 'KID1',
        status: 'approved',
        actions: [
          {
            id: 'a1',
            status: 'success',
            processing_done: true,
            type: 'selfie',
            face_match_status: 'done',
          },
        ],
      });
    const s = await gateway.getStatus('KID1');
    expect(s).toMatchObject({
      providerRequestId: 'KID1',
      status: 'approved',
      actions: [
        {
          id: 'a1',
          status: 'success',
          processingDone: true,
          type: 'selfie',
          faceMatchStatus: 'done',
        },
      ],
    });
    expect(
      fromStatusResponse(
        { request_details: { id: 'KID2', status: 'requested' } } as never,
        'KID2',
      ),
    ).toMatchObject({
      providerRequestId: 'KID2',
      status: 'requested',
      actions: [],
    });
    expect(fromStatusResponse({} as never, 'KID3')).toMatchObject({
      providerRequestId: 'KID3',
      status: 'unknown',
    });
    expect(redactForEvidence({ id: 'x', status: 's' })).toEqual({
      id: 'x',
      status: 's',
      actions: undefined,
    });
  });

  it('downloads media as bytes and maps failures', async () => {
    nock(BASE)
      .get(DIGISTUDIO_PATHS.media('F1'))
      .reply(200, Buffer.from('img'), { 'content-type': 'image/jpeg' });
    await expect(gateway.downloadMedia('F1')).resolves.toMatchObject({
      contentType: 'image/jpeg',
    });
    nock(BASE).get(DIGISTUDIO_PATHS.media('F1')).reply(503, {});
    await expect(gateway.downloadMedia('F1')).rejects.toBeInstanceOf(
      DependencyUnavailableError,
    );
  });
});

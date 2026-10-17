import nock from 'nock';
import { CorrelationStore } from '../../../../common/correlation/correlation.store';
import {
  DependencyUnavailableError,
  PartnerRejectedError,
  ValidationError,
} from '../../../../common/errors/app-error';
import { CircuitBreakerRegistry } from '../../../../common/http/circuit-breaker.registry';
import { HttpClientService } from '../../../../common/http/http-client.service';
import { toIsoDate } from '../../../../domain/shared/iso-date';
import { DigioKraGateway, KRA_PATHS } from './kra.gateway';

const BASE = 'http://digio.test';
const AUTH = 'Basic ' + Buffer.from('cid:csecret').toString('base64');

describe('DigioKraGateway', () => {
  const store = new CorrelationStore();
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  };
  logger.child.mockReturnValue(logger);
  const http = new HttpClientService(
    store,
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
  const cfg = {
    digio: {
      baseUrl: BASE,
      clientId: 'cid',
      clientSecret: 'csecret',
      timeoutMs: 1000,
      webhookSecret: '',
    },
  } as never;
  const gateway = new DigioKraGateway(http, cfg);

  beforeEach(() => nock.cleanAll());
  afterAll(() => nock.restore());

  it('checkPanStatus sends basic auth, X_REFERENCE_ID = uniqueRequestId and the vendor body', async () => {
    const scope = nock(BASE, {
      reqheaders: { authorization: AUTH, x_reference_id: 'u-1' },
    })
      .post(KRA_PATHS.checkPanStatus, {
        pan_no: 'ABJPM6976J',
        fetch_type: 'I',
        unique_request_id: 'u-1',
      })
      .reply(200, {
        pan_number: 'ABJPM6976J',
        status_code: '007',
        status: 'Validated',
      });
    const out = await gateway.checkPanStatus({
      pan: 'abjpm6976j',
      fetchType: 'I',
      uniqueRequestId: 'u-1',
    });
    expect(out).toMatchObject({ pan: 'ABJPM6976J', statusCode: '007' });
    expect(scope.isDone()).toBe(true);
  });

  it('fetchDetails adds deserialize_codes and requires dob', async () => {
    nock(BASE)
      .post(KRA_PATHS.fetchDetails)
      .query({ deserialize_codes: 'true' })
      .reply(200, { personal_information: { pan_number: 'ABJPM6976J' } });
    const out = await gateway.fetchDetails(
      {
        pan: 'ABJPM6976J',
        dob: toIsoDate('1955-08-16'),
        uniqueRequestId: 'u-2',
      },
      { deserializeCodes: true },
    );
    expect(out.pan).toBe('ABJPM6976J');
    await expect(
      gateway.fetchDetails({
        pan: 'ABJPM6976J',
        uniqueRequestId: 'u',
      } as never),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('fetchDetails omits the query when deserializeCodes is not given and accepts application/zip downloads', async () => {
    nock(BASE)
      .post(KRA_PATHS.fetchDetails)
      .query((q) => Object.keys(q).length === 0)
      .reply(200, {});
    await expect(
      gateway.fetchDetails({
        pan: 'ABJPM6976J',
        dob: toIsoDate('1955-08-16'),
        uniqueRequestId: 'u',
      }),
    ).resolves.toBeDefined();
    nock(BASE)
      .post(KRA_PATHS.downloadDocuments)
      .reply(200, Buffer.from('PK'), { 'content-type': 'application/zip' });
    await expect(
      gateway.downloadDocuments({
        pan: 'ABJPM6976J',
        dob: toIsoDate('1955-08-16'),
        kraCode: 'CVLKRA',
        serviceProvider: 'CDSL',
      }),
    ).resolves.toBeInstanceOf(Buffer);
    await expect(
      gateway.checkPanStatus({
        pan: undefined as unknown as string,
        uniqueRequestId: 'u',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a malformed PAN before calling Digio', async () => {
    await expect(
      gateway.checkPanStatus({ pan: 'nope', uniqueRequestId: 'u' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(nock.pendingMocks()).toHaveLength(0);
  });

  it('register posts the registration envelope and maps the result', async () => {
    nock(BASE)
      .post(
        KRA_PATHS.register,
        (b: Record<string, unknown>) =>
          b.unique_request_id === 'u-3' &&
          typeof b.common_kra_registration_request === 'object',
      )
      .reply(200, { request_id: 'KRA1', status: 'SUBMITTED' });
    const out = await gateway.register({
      uniqueRequestId: 'u-3',
      apiRequestType: 'stateless',
      registration: { pan_no: 'WLMPT9867F' },
    });
    expect(out).toMatchObject({ requestId: 'KRA1', status: 'SUBMITTED' });
  });

  it('downloadDocuments returns the ZIP bytes and rejects a JSON 200', async () => {
    nock(BASE)
      .post(KRA_PATHS.downloadDocuments, {
        pan_no: 'ABJPM6976J',
        ref_no: 'REF1',
        kraCode: 'CVLKRA',
        serviceProvider: 'CDSL',
      })
      .reply(200, Buffer.from('PK\x03\x04'), {
        'content-type': 'application/octet-stream',
      });
    const zip = await gateway.downloadDocuments({
      pan: 'ABJPM6976J',
      refNo: 'REF1',
      kraCode: 'CVLKRA',
      serviceProvider: 'CDSL',
    });
    expect(zip.subarray(0, 2).toString()).toBe('PK');

    nock(BASE)
      .post(KRA_PATHS.downloadDocuments)
      .reply(200, JSON.stringify({ message: 'no docs' }), {
        'content-type': 'application/json',
      });
    await expect(
      gateway.downloadDocuments({
        pan: 'ABJPM6976J',
        refNo: 'REF1',
        kraCode: 'CVLKRA',
        serviceProvider: 'CDSL',
      }),
    ).rejects.toBeInstanceOf(PartnerRejectedError);
    await expect(
      gateway.downloadDocuments({
        pan: 'ABJPM6976J',
        kraCode: 'CVLKRA',
        serviceProvider: 'CDSL',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('maps Digio 400 to PartnerRejectedError with vendor code and 5xx/transport to DependencyUnavailableError', async () => {
    nock(BASE).post(KRA_PATHS.checkPanStatus).reply(400, {
      code: 'REQUEST_VALIDATION_FAILED',
      message: 'Request Validation Failed',
      details: 'EX1',
    });
    const rejected = (await gateway
      .checkPanStatus({ pan: 'ABJPM6976J', uniqueRequestId: 'u' })
      .catch((e: unknown) => e)) as PartnerRejectedError;
    expect(rejected).toBeInstanceOf(PartnerRejectedError);
    expect(rejected.vendorCode).toBe('REQUEST_VALIDATION_FAILED');
    expect(rejected.details).toMatchObject({
      vendorMessage: 'Request Validation Failed',
      vendorDetails: 'EX1',
    });

    nock(BASE)
      .post(KRA_PATHS.checkPanStatus)
      .reply(500, { code: 'SYSTEM_ERROR', message: 'Invalid API credentials' });
    await expect(
      gateway.checkPanStatus({ pan: 'ABJPM6976J', uniqueRequestId: 'u' }),
    ).rejects.toBeInstanceOf(DependencyUnavailableError);

    nock(BASE).post(KRA_PATHS.checkPanStatus).replyWithError('ECONNRESET');
    await expect(
      gateway.checkPanStatus({ pan: 'ABJPM6976J', uniqueRequestId: 'u' }),
    ).rejects.toBeInstanceOf(DependencyUnavailableError);
  });
});

import nock from 'nock';
import { CorrelationStore } from '../../../../common/correlation/correlation.store';
import {
  DependencyUnavailableError,
  PartnerRejectedError,
} from '../../../../common/errors/app-error';
import { CircuitBreakerRegistry } from '../../../../common/http/circuit-breaker.registry';
import { HttpClientService } from '../../../../common/http/http-client.service';
import {
  BANK_PATHS,
  DigioBankGateway,
  fromVerifyResponse,
} from './bank.gateway';

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
const gateway = new DigioBankGateway(http, {
  digio: {
    baseUrl: BASE,
    clientId: 'c',
    clientSecret: 's',
    timeoutMs: 1000,
    webhookSecret: '',
    kycTemplateName: 'T',
  },
} as never);
const cmd = {
  accountNumber: '123456789012',
  ifsc: 'HDFC0001234',
  beneficiaryName: 'VINOD KUMAR SINGH',
  validationMode: 'AUTO' as const,
  uniqueRequestId: 'bv-1',
};

describe('DigioBankGateway', () => {
  beforeEach(() => nock.cleanAll());
  afterAll(() => nock.restore());

  it('posts the documented request and maps a successful verification', async () => {
    nock(BASE, { reqheaders: { x_reference_id: 'bv-1' } })
      .post(BANK_PATHS.verify, {
        beneficiary_account_no: '123456789012',
        beneficiary_ifsc: 'HDFC0001234',
        beneficiary_name: 'VINOD KUMAR SINGH',
        validation_mode: 'AUTO',
        unique_request_id: 'bv-1',
      })
      .reply(200, {
        id: 'FTI1',
        verified: true,
        verified_at: '2026-10-18 10:00:00',
        beneficiary_name_with_bank: 'VINOD K SINGH',
        fuzzy_match_score: 88,
        fuzzy_match_result: true,
        validation_mode: 'PENNY_LESS',
      });
    expect(await gateway.verify(cmd)).toMatchObject({
      providerReference: 'FTI1',
      verified: true,
      fuzzyMatchScore: 88,
      fuzzyMatchResult: true,
      beneficiaryNameWithBank: 'VINOD K SINGH',
      validationMode: 'PENNY_LESS',
    });
  });
  it('maps a failed verification and odd shapes', async () => {
    nock(BASE).post(BANK_PATHS.verify).reply(200, {
      id: 'FTI2',
      verified: false,
      error_msg: 'Invalid beneficiary account details',
      error_code: 'E1',
    });
    expect(await gateway.verify(cmd)).toMatchObject({
      verified: false,
      errorCode: 'E1',
      errorMessage: 'Invalid beneficiary account details',
      fuzzyMatchScore: undefined,
    });
    expect(fromVerifyResponse({})).toMatchObject({ verified: false });
    expect(
      fromVerifyResponse({ verified: true, fuzzy_match_score: 'x' as never })
        .fuzzyMatchScore,
    ).toBeUndefined();
  });
  it('translates 4xx and 5xx', async () => {
    nock(BASE)
      .post(BANK_PATHS.verify)
      .reply(400, { code: 'REQUEST_VALIDATION_FAILED' });
    await expect(gateway.verify(cmd)).rejects.toBeInstanceOf(
      PartnerRejectedError,
    );
    nock(BASE).post(BANK_PATHS.verify).reply(503, {});
    await expect(gateway.verify(cmd)).rejects.toBeInstanceOf(
      DependencyUnavailableError,
    );
  });
});

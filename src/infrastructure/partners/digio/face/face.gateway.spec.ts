import nock from 'nock';
import { CorrelationStore } from '../../../../common/correlation/correlation.store';
import { CircuitBreakerRegistry } from '../../../../common/http/circuit-breaker.registry';
import { HttpClientService } from '../../../../common/http/http-client.service';
import { DigioFaceGateway, FACE_PATHS } from './face.gateway';

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
const gateway = new DigioFaceGateway(http, {
  digio: {
    baseUrl: BASE,
    clientId: 'c',
    clientSecret: 's',
    timeoutMs: 1000,
    webhookSecret: '',
  },
} as never);

describe('DigioFaceGateway', () => {
  beforeEach(() => nock.cleanAll());
  afterAll(() => nock.restore());

  it('posts multipart liveness and maps PASS/FAIL/UNKNOWN', async () => {
    nock(BASE, { reqheaders: { 'content-type': /multipart\/form-data/ } })
      .post(FACE_PATHS.liveness)
      .reply(200, { score: 90, result: 'PASS' });
    expect(
      await gateway.liveness(Buffer.from('x'), 'image/jpeg', 'u1'),
    ).toMatchObject({ result: 'PASS', score: 90, errors: [] });
    nock(BASE)
      .post(FACE_PATHS.liveness)
      .reply(200, {
        score: 12,
        result: 'FAIL',
        errors: ['Photo of photo detected'],
      });
    expect(
      await gateway.liveness(Buffer.from('x'), 'image/jpeg', 'u2'),
    ).toMatchObject({ result: 'FAIL', errors: ['Photo of photo detected'] });
    nock(BASE).post(FACE_PATHS.liveness).reply(200, {});
    expect(
      await gateway.liveness(Buffer.from('x'), 'image/jpeg', 'u3'),
    ).toMatchObject({ result: 'UNKNOWN', score: 0 });
  });

  it('posts multipart face match and tolerates both verdict keys', async () => {
    nock(BASE)
      .post(FACE_PATHS.faceMatch)
      .reply(200, { confidence: 90, match_result: 'matched' });
    expect(
      await gateway.faceMatch(
        Buffer.from('a'),
        Buffer.from('b'),
        'image/jpeg',
        80,
        'u4',
      ),
    ).toMatchObject({ matchResult: 'matched', confidence: 90 });
    nock(BASE)
      .post(FACE_PATHS.faceMatch)
      .reply(200, { confidence: 40, result: 'not_matched' });
    expect(
      await gateway.faceMatch(
        Buffer.from('a'),
        Buffer.from('b'),
        'image/jpeg',
        80,
        'u5',
      ),
    ).toMatchObject({ matchResult: 'not_matched' });
    nock(BASE).post(FACE_PATHS.faceMatch).reply(200, { confidence: 0 });
    expect(
      await gateway.faceMatch(
        Buffer.from('a'),
        Buffer.from('b'),
        'image/jpeg',
        80,
        'u6',
      ),
    ).toMatchObject({ matchResult: 'none' });
  });
});

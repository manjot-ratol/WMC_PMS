import nock from 'nock';
import { CircuitBreakerRegistry } from '../../../../common/http/circuit-breaker.registry';
import { HttpClientService } from '../../../../common/http/http-client.service';
import { CorrelationStore } from '../../../../common/correlation/correlation.store';
import { silentLogger } from '../../../../../test/support/fakes';
import {
  DigioEsignGateway,
  fromDocumentResponse,
  toUploadRequest,
} from './esign.gateway';
import { DigioCkycGateway } from '../ckyc/ckyc.gateway';

const BASE = 'http://digio.test';
const cfg = {
  digio: {
    baseUrl: BASE,
    clientId: 'id',
    clientSecret: 'secret',
    timeoutMs: 2000,
    webhookSecret: '',
    kycTemplateName: 'T',
    esign: { signType: 'aadhaar', expireDays: 10 },
  },
} as never;

describe('DigioEsignGateway', () => {
  let gw: DigioEsignGateway;
  let ckyc: DigioCkycGateway;
  beforeAll(() => {
    const http = new HttpClientService(
      new CorrelationStore(),
      silentLogger as never,
      new CircuitBreakerRegistry(),
    );
    gw = new DigioEsignGateway(http, cfg);
    ckyc = new DigioCkycGateway(http, cfg);
  });
  afterEach(() => nock.cleanAll());

  it('maps the upload command to the vendor shape and the response to domain', async () => {
    const cmd = {
      fileName: 'pack.pdf',
      file: Buffer.from('%PDF-1.4'),
      signer: {
        identifier: 'c@example.com',
        name: 'Vinod',
        reason: 'PMS agreement',
      },
      expireInDays: 10,
      referenceId: 'app_1',
      customReference: 'ss_1',
    };
    const req = toUploadRequest(cmd, 'aadhaar');
    expect(req).toMatchObject({
      file_name: 'pack.pdf',
      file_data: Buffer.from('%PDF-1.4').toString('base64'),
      signers: [
        {
          identifier: 'c@example.com',
          name: 'Vinod',
          reason: 'PMS agreement',
          sign_type: 'aadhaar',
        },
      ],
      expire_in_days: 10,
      generate_access_token: true,
      reference_id: 'app_1',
      custom_reference: 'ss_1',
      notify_signers: false,
    });
    nock(BASE)
      .post(
        '/v2/client/document/uploadpdf',
        (b: Record<string, unknown>) => b.custom_reference === 'ss_1',
      )
      .matchHeader(
        'authorization',
        `Basic ${Buffer.from('id:secret').toString('base64')}`,
      )
      .matchHeader('X_REFERENCE_ID', 'ss_1')
      .reply(200, {
        id: 'DID1',
        agreement_status: 'requested',
        access_token: { id: 'GWT1', validTill: '2099-01-01' },
        signing_parties: [{ identifier: 'c@example.com', status: 'requested' }],
      });
    const r = await gw.createSignRequest(cmd);
    expect(r).toMatchObject({
      providerDocumentId: 'DID1',
      agreementStatus: 'requested',
      accessToken: { id: 'GWT1', validTill: '2099-01-01' },
    });
    nock(BASE)
      .post('/v2/client/document/uploadpdf')
      .reply(200, { agreement_status: 'requested' });
    await expect(gw.createSignRequest(cmd)).rejects.toThrow(/no document id/);
  });

  it('reads document status, downloads the signed file and cancels', async () => {
    nock(BASE)
      .get('/v2/client/document/DID1')
      .reply(200, {
        id: 'DID1',
        agreement_status: 'completed',
        signing_parties: [
          { identifier: 'c@example.com', name: 'V', status: 'signed' },
        ],
      });
    expect(await gw.getDocument('DID1')).toMatchObject({
      providerDocumentId: 'DID1',
      agreementStatus: 'completed',
      signers: [{ identifier: 'c@example.com', status: 'signed' }],
    });
    expect(fromDocumentResponse({})).toEqual({
      providerDocumentId: '',
      agreementStatus: '',
      signers: [],
      raw: {},
    });
    nock(BASE)
      .get('/v2/client/document/download')
      .query({ document_id: 'DID1' })
      .reply(200, Buffer.from('%PDF-signed'), {
        'content-type': 'application/pdf',
      });
    expect((await gw.downloadSigned('DID1')).toString()).toBe('%PDF-signed');
    nock(BASE)
      .post('/v2/client/document/DID1/cancel')
      .reply(200, { agreement_status: 'requested' });
    await expect(gw.cancel('DID1', 'superseded')).resolves.toBeUndefined();
    nock(BASE).get('/v2/client/document/DID9').reply(503, { message: 'down' });
    await expect(gw.getDocument('DID9')).rejects.toMatchObject({
      code: 'VERIFICATION_UNAVAILABLE',
    });
  });

  it('CKYC register sends multipart with the JSON part and files', async () => {
    let contentType = '';
    let body = '';
    nock(BASE)
      .post('/v3/client/kyc/ckyc/register', (b: string) => {
        body = String(b);
        return true;
      })
      .reply(function () {
        contentType = String(this.req.headers['content-type']);
        return [200, { request_id: 'CK1', status: 'UPLOAD_PENDING' }];
      });
    const r = await ckyc.register({
      registration: { personal_details: { full_name: 'V' } },
      files: [
        {
          field: 'photograph',
          fileName: 'p.jpg',
          contentType: 'image/jpeg',
          data: Buffer.from('img'),
        },
      ],
      uniqueRequestId: 'u1',
    });
    expect(r).toMatchObject({
      providerRequestId: 'CK1',
      status: 'UPLOAD_PENDING',
    });
    expect(contentType).toMatch(/multipart\/form-data/);
    expect(body).toContain('register_ckyc_request');
    expect(body).toContain('"full_name":"V"');
    expect(body).toContain('filename="p.jpg"');
  });
});

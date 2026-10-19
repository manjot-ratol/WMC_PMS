import { createDecipheriv } from 'node:crypto';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import nock from 'nock';
import { silentLogger } from '../../../../test/support/fakes';
import { CorrelationStore } from '../../../common/correlation/correlation.store';
import { CircuitBreakerRegistry } from '../../../common/http/circuit-breaker.registry';
import { HttpClientService } from '../../../common/http/http-client.service';
import {
  MfCentralLocalCrypto,
  MFCENTRAL_LOCAL_CRYPTO_STATUS,
} from './mfcentral-local.crypto';
import { MfCentralGateway, unwrapSignature } from './mfcentral.gateway';

const BASE = 'http://mfc.test';
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const jwk = {
  keys: [
    {
      ...(privateKey.export({ format: 'jwk' }) as Record<string, unknown>),
      kid: 'kid-1',
      use: 'sig',
    },
  ],
};
const cfg = (over: Record<string, unknown> = {}) =>
  ({
    mfcentral: {
      baseUrl: BASE,
      clientId: 'cid',
      clientSecret: 'csec',
      username: 'u',
      password: 'p',
      encryptionKey: 'shared-key-20-chars!',
      privateJwk: JSON.stringify(jwk),
      timeoutMs: 2000,
      cryptoMode: 'remote',
      appUrl: 'https://mfc-cas-uat.mfcentral.com',
      redirectUrl: 'http://localhost:3000/v1/integrations/mfcentral/callback',
      returnUrl: 'http://localhost:5173/onboarding/portfolio-import',
      importTtlMinutes: 15,
      urlEncryptionKey: 'local-url-encryption-key-32bytes',
      ...over,
    },
  }) as never;
const http = () =>
  new HttpClientService(
    new CorrelationStore(),
    silentLogger as never,
    new CircuitBreakerRegistry(),
  );
const tokenStub = () =>
  nock(BASE)
    .post('/oauth/token', 'username=u&password=p&grant_type=password')
    .matchHeader(
      'authorization',
      `Basic ${Buffer.from('cid:csec').toString('base64')}`,
    )
    .reply(200, { access_token: 'tok', expires_in: 3600 });

describe('MfCentralGateway (remote helper crypto, as in the UAT collection)', () => {
  afterEach(() => nock.cleanAll());
  it('runs token → encrypt → sign → newCasRequest → decrypt with the collection headers', async () => {
    tokenStub();
    nock(BASE)
      .post(
        '/api/test/encrypt',
        (b: unknown) =>
          (typeof b === 'string'
            ? (JSON.parse(b) as { pan: string })
            : (b as { pan: string })
          ).pan === 'ABCPE1234F',
      )
      .matchHeader('ClientId', 'cid')
      .matchHeader('Authorization', 'Bearer tok')
      .matchHeader('key', 'shared-key-20-chars!')
      .reply(200, 'ENC_REQ');
    nock(BASE)
      .post('/api/test/generateSignature', 'ENC_REQ')
      .matchHeader('key', JSON.stringify(jwk))
      .reply(200, 'hdr..sig');
    nock(BASE)
      .post('/api/client/V1/newCasRequest', {
        signature: 'hdr..sig',
        request: 'ENC_REQ',
      })
      .matchHeader('Origin', 'https://mfc-cas-uat.mfcentral.com')
      .reply(200, { response: 'ENC_RES' });
    nock(BASE)
      .post('/api/test/decrypt', 'ENC_RES')
      .reply(
        200,
        JSON.stringify({
          reqId: '3088880',
          clientRefNo: 'ref1',
          status: 'SUCCESS',
        }),
      );
    const gw = new MfCentralGateway(http(), cfg());
    const r = await gw.newCasRequest({
      clientRefNo: 'ref1',
      pan: 'ABCPE1234F',
      mobile: '+919000000001',
      redirectUrl: 'https://app.wmc/return',
    });
    expect(r).toMatchObject({
      reqId: '3088880',
      clientRefNo: 'ref1',
      status: 'SUCCESS',
    });
    // token is cached for the second call
    nock(BASE).post('/api/test/encrypt').reply(200, 'E2');
    nock(BASE).post('/api/test/generateSignature').reply(200, 'S2');
    nock(BASE)
      .post('/api/client/V1/validateQRCode', { signature: 'S2', request: 'E2' })
      .reply(200, { status: 'OK', reqId: 1 });
    expect(
      await gw.validateQrCode({
        clientRefNo: 'ref1',
        reqId: '3088880',
        qrCode: 'iVBORw0K',
      }),
    ).toMatchObject({ reqId: '1', status: 'OK' });
    // hand-off URL: AES-256-CBC with the 32-byte URL key, <iv_hex>:<cipher_hex>, on MF Central's /api/auth/start
    const url = new URL(
      gw.buildHandoffUrl({
        reqId: '3088880',
        otpRef: 'otp-1',
        clientRefNo: 'ref1',
        pan: 'ABCPE1234F',
        mobile: '+919876543210',
        redirectUrl: 'http://cb',
      }),
    );
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://mfc-cas-uat.mfcentral.com/api/auth/start',
    );
    const [ivHex, ctHex] = url.searchParams.get('data')!.split(':');
    const decipher = createDecipheriv(
      'aes-256-cbc',
      Buffer.from('local-url-encryption-key-32bytes'),
      Buffer.from(ivHex, 'hex'),
    );
    const plain = JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(ctHex, 'hex')),
        decipher.final(),
      ]).toString('utf8'),
    ) as Record<string, unknown>;
    expect(plain).toEqual({
      reqId: '3088880',
      otpRef: 'otp-1',
      token: '',
      clientRefNo: 'ref1',
      pan: 'ABCPE1234F',
      pekrn: '',
      email: '',
      mobile: '+919876543210',
      redirectUrl: 'http://cb',
    });
    expect(() =>
      new MfCentralGateway(
        http(),
        cfg({ urlEncryptionKey: 'short' }),
      ).buildHandoffUrl({
        reqId: '1',
        otpRef: 'o',
        clientRefNo: 'c',
        pan: 'ABCPE1234F',
        redirectUrl: 'http://cb',
      }),
    ).toThrow('32 bytes');
  });
  it('decrypts an encrypted validation rejection and surfaces the vendor errors', async () => {
    tokenStub();
    nock(BASE).post('/api/test/encrypt').reply(200, 'E1');
    nock(BASE).post('/api/test/generateSignature').reply(200, 'S1');
    nock(BASE)
      .post('/api/client/V1/newCasRequest')
      .reply(422, { signature: 'x', response: 'ENC_ERR' });
    nock(BASE)
      .post('/api/test/decrypt', 'ENC_ERR')
      .reply(
        200,
        JSON.stringify({
          reqId: '529',
          errors: [{ code: '422', message: 'Invalid Input' }],
        }),
      );
    await expect(
      new MfCentralGateway(http(), cfg()).newCasRequest({
        clientRefNo: 'r',
        pan: 'P',
        redirectUrl: 'u',
      }),
    ).rejects.toMatchObject({
      code: 'PARTNER_REJECTED',
      vendorCode: '422',
      details: {
        reqId: '529',
        vendorErrors: [{ code: '422', message: 'Invalid Input' }],
      },
    });
  });
  it('maps token failures, vendor rejections and outages', async () => {
    nock(BASE).post('/oauth/token').reply(200, { token_type: 'bearer' });
    await expect(
      new MfCentralGateway(http(), cfg()).newCasRequest({
        clientRefNo: 'r',
        pan: 'P',
        redirectUrl: 'u',
      }),
    ).rejects.toMatchObject({ code: 'PARTNER_REJECTED' });
    nock(BASE).post('/oauth/token').reply(401, { error: 'invalid_client' });
    await expect(
      new MfCentralGateway(http(), cfg()).newCasRequest({
        clientRefNo: 'r',
        pan: 'P',
        redirectUrl: 'u',
      }),
    ).rejects.toMatchObject({ code: 'PARTNER_REJECTED' });
    nock(BASE).post('/oauth/token').reply(503, {});
    await expect(
      new MfCentralGateway(http(), cfg()).newCasRequest({
        clientRefNo: 'r',
        pan: 'P',
        redirectUrl: 'u',
      }),
    ).rejects.toMatchObject({ code: 'VERIFICATION_UNAVAILABLE' });
  });
});

describe('MfCentralLocalCrypto (unverified placeholder)', () => {
  it('produces a detached RS256 JWS with b64:false that verifies with the public key, and round-trips encryption', async () => {
    expect(MFCENTRAL_LOCAL_CRYPTO_STATUS).toBe(
      'UNVERIFIED_PENDING_MFCENTRAL_CONFIRMATION',
    );
    const c = new MfCentralLocalCrypto(
      'shared-key-20-chars!',
      JSON.stringify(jwk),
    );
    const enc = await c.encrypt('{"a":1}');
    expect(enc).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await c.decrypt(enc)).toBe('{"a":1}');
    expect(
      await new MfCentralLocalCrypto(
        'shared-key-20-chars!',
        JSON.stringify(jwk.keys[0]),
      ).decrypt(enc),
    ).toBe('{"a":1}');
    const jws = await c.sign(enc);
    const [header, payload, sig] = jws.split('.');
    expect(payload).toBe('');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
      alg: 'RS256',
      kid: 'kid-1',
      b64: false,
      crit: ['b64'],
    });
    expect(
      createVerify('RSA-SHA256')
        .update(`${header}.${enc}`)
        .verify(publicKey, Buffer.from(sig, 'base64url')),
    ).toBe(true);
    await expect(c.decrypt(enc.slice(0, -4) + 'AAAA')).rejects.toThrow();
  });
  it('local mode wires into the gateway', async () => {
    tokenStub();
    let sent: { signature: string; request: string } | undefined;
    nock(BASE)
      .post(
        '/api/client/V1/newCasRequest',
        (b: { signature: string; request: string }) => {
          sent = b;
          return true;
        },
      )
      .reply(200, { reqId: '7', status: 'SUCCESS' });
    const gw = new MfCentralGateway(http(), cfg({ cryptoMode: 'local' }));
    const r = await gw.newCasRequest({
      clientRefNo: 'ref',
      pan: 'ABCPE1234F',
      redirectUrl: 'u',
    });
    expect(r).toMatchObject({ reqId: '7', status: 'SUCCESS' });
    expect(sent!.signature.split('.')).toHaveLength(3);
    expect(
      await new MfCentralLocalCrypto(
        'shared-key-20-chars!',
        JSON.stringify(jwk),
      ).decrypt(sent!.request),
    ).toContain('ABCPE1234F');
  });
});

describe('unwrapSignature (UAT helper wraps the JWS)', () => {
  it('extracts x-jws-signature from the helper JSON and leaves a bare JWS alone', () => {
    expect(unwrapSignature('{"x-jws-signature":"hdr..sig"}\n')).toBe(
      'hdr..sig',
    );
    expect(unwrapSignature('{"signature":"hdr..sig"}')).toBe('hdr..sig');
    expect(unwrapSignature(' hdr..sig ')).toBe('hdr..sig');
    expect(unwrapSignature('{"other":1}')).toBe('{"other":1}');
    expect(unwrapSignature('{not json')).toBe('{not json');
  });
});

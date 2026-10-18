import * as fs from 'node:fs';
import * as path from 'node:path';
import nock from 'nock';
import { silentLogger } from '../../../../test/support/fakes';
import { TrackWizzMock } from './trackwizz-mock.server';
import { CorrelationStore } from '../../../common/correlation/correlation.store';
import { CircuitBreakerRegistry } from '../../../common/http/circuit-breaker.registry';
import { HttpClientService } from '../../../common/http/http-client.service';
import {
  DEFAULT_CRYPTO_PROFILE,
  EnvelopeError,
  TrackWizzEnvelope,
  parseCryptoProfile,
} from './trackwizz-envelope';
import { TrackWizzGateway } from './trackwizz.gateway';

const dir = path.resolve(__dirname, '../../../../test/fixtures/trackwizz');
const key = (n: string) => fs.readFileSync(path.join(dir, n), 'utf8');
const ours = new TrackWizzEnvelope(
  key('our_private.pem'),
  key('their_public.pem'),
);
const theirs = new TrackWizzEnvelope(
  key('their_private.pem'),
  key('our_public.pem'),
);

describe('TrackWizzEnvelope', () => {
  it('round-trips through the documented steps and the peer can open what we seal', () => {
    const sealed = ours.seal({ requestId: 'r1', purpose: '01,04' });
    expect(Object.keys(sealed)).toEqual([
      'EncryptedData',
      'EncryptionKey',
      'Signature',
    ]);
    expect(theirs.open(sealed)).toEqual({ requestId: 'r1', purpose: '01,04' });
    expect(ours.open(theirs.seal({ RequestId: 'r1' }))).toEqual({
      RequestId: 'r1',
    });
  });
  it('rejects tampered signatures, foreign keys, corrupted ciphertext and malformed envelopes before reading anything', () => {
    const sealed = theirs.seal({ RequestId: 'r1' });
    expect(() =>
      ours.open({ ...sealed, Signature: Buffer.from('x').toString('base64') }),
    ).toThrow(EnvelopeError);
    expect(() =>
      ours.open({
        ...sealed,
        EncryptedData: sealed.EncryptedData.slice(0, -8) + 'AAAAAAAA',
      }),
    ).toThrow(/signature/);
    const selfSealed = ours.seal({ a: 1 }); // signed by us, not by TrackWizz
    try {
      ours.open(selfSealed);
      throw new Error('expected failure');
    } catch (e) {
      expect((e as EnvelopeError).category).toBe('signature_invalid');
    }
    expect(() => ours.open(null)).toThrow(/missing/);
    expect(() => ours.open({ EncryptedData: 'a' })).toThrow(EnvelopeError);
    // valid signature but a key we cannot unwrap: re-sign a foreign envelope with their key
    const stranger = new TrackWizzEnvelope(
      key('their_private.pem'),
      key('their_public.pem'),
    );
    const foreign = stranger.seal({ x: 1 });
    try {
      ours.open(foreign);
      throw new Error('expected failure');
    } catch (e) {
      expect((e as EnvelopeError).category).toBe('key_unwrap_failed');
    }
  });
  it('profiles: every configured variant round-trips; invalid combinations are rejected', () => {
    for (const p of [
      {
        cipher: 'aes-128-cbc' as const,
        sessionKeyBytes: 16 as const,
        iv: 'prefixed' as const,
        rsaPadding: 'oaep-sha1' as const,
      },
      {
        cipher: 'aes-256-ecb' as const,
        iv: 'none' as const,
        rsaPadding: 'oaep-sha256' as const,
        signatureAlgorithm: 'RSA-SHA512' as const,
        signInput: 'key+data' as const,
      },
    ]) {
      const profile = parseCryptoProfile(JSON.stringify(p));
      const a = new TrackWizzEnvelope(
        key('our_private.pem'),
        key('their_public.pem'),
        profile,
      );
      const b = new TrackWizzEnvelope(
        key('their_private.pem'),
        key('our_public.pem'),
        profile,
      );
      expect(b.open(a.seal({ ok: true }))).toEqual({ ok: true });
    }
    expect(parseCryptoProfile(undefined)).toEqual(DEFAULT_CRYPTO_PROFILE);
    expect(parseCryptoProfile('  ')).toEqual(DEFAULT_CRYPTO_PROFILE);
    expect(() => parseCryptoProfile('{"sessionKeyBytes":12}')).toThrow(
      /sessionKeyBytes/,
    );
    expect(() => parseCryptoProfile('{"cipher":"aes-256-ecb"}')).toThrow(/ECB/);
  });
});

describe('TrackWizzGateway', () => {
  const cfg = (over: Record<string, unknown> = {}) =>
    ({
      trackwizz: {
        baseUrl: 'http://tw.test',
        apiToken: 'tok',
        cluster: 'CL1_User',
        domain: 'wmc.local',
        sourceSystemName: 'WMCPMS',
        ourPrivateKeyPem: key('our_private.pem'),
        theirPublicKeyPem: key('their_public.pem'),
        timeoutMs: 2000,
        cryptoProfile: '',
        ...over,
      },
    }) as never;
  const http = () =>
    new HttpClientService(
      new CorrelationStore(),
      silentLogger as never,
      new CircuitBreakerRegistry(),
    );
  afterEach(() => nock.cleanAll());

  it('seals the request with the headers from the document and opens the signed reply', async () => {
    const gw = new TrackWizzGateway(http(), cfg());
    nock('http://tw.test')
      .post(
        '/CustomerInfo/as501',
        (b: {
          EncryptedData: string;
          EncryptionKey: string;
          Signature: string;
        }) => {
          const req = theirs.open<{ requestId: string }>(b);
          return req.requestId === 'sr_1';
        },
      )
      .matchHeader('ApiToken', 'tok')
      .matchHeader('Cluster', 'CL1_User')
      .matchHeader('Domain', 'wmc.local')
      .reply(
        200,
        theirs.seal({
          RequestId: 'sr_1',
          DecryptedData: {
            OverallStatus: 'AcceptedByTW',
            CustomerResponse: [],
          },
        }),
      );
    const r = await gw.submit({
      requestId: 'sr_1',
      sourceSystemName: 'WMCPMS',
      purpose: '01,04',
      customerList: [{ pan: 'X' }],
    });
    expect(r.response).toMatchObject({
      RequestId: 'sr_1',
      DecryptedData: { OverallStatus: 'AcceptedByTW' },
    });
    expect(Object.keys(r.envelope)).toEqual([
      'EncryptedData',
      'EncryptionKey',
      'Signature',
    ]);
  });
  it('maps bad signatures, vendor rejections and outages to partner errors; missing keys fail loudly', async () => {
    const gw = new TrackWizzGateway(http(), cfg());
    const sealed = theirs.seal({ RequestId: 'sr_1' });
    nock('http://tw.test')
      .post('/CustomerInfo/as501')
      .reply(200, {
        ...sealed,
        Signature: Buffer.from('bad').toString('base64'),
      });
    await expect(
      gw.submit({
        requestId: 'sr_1',
        sourceSystemName: 'W',
        purpose: '06',
        customerList: [],
      }),
    ).rejects.toMatchObject({
      code: 'PARTNER_REJECTED',
      details: { category: 'signature_invalid' },
    });
    nock('http://tw.test')
      .post('/CustomerInfo/as501')
      .reply(400, { message: 'MRV14' });
    await expect(
      gw.submit({
        requestId: 'sr_1',
        sourceSystemName: 'W',
        purpose: '06',
        customerList: [],
      }),
    ).rejects.toMatchObject({ code: 'PARTNER_REJECTED' });
    nock('http://tw.test').post('/CustomerInfo/as501').reply(503, {});
    await expect(
      gw.submit({
        requestId: 'sr_1',
        sourceSystemName: 'W',
        purpose: '06',
        customerList: [],
      }),
    ).rejects.toMatchObject({ code: 'VERIFICATION_UNAVAILABLE' });
    await expect(
      new TrackWizzGateway(http(), cfg({ ourPrivateKeyPem: '' })).submit({
        requestId: 'x',
        sourceSystemName: 'W',
        purpose: '06',
        customerList: [],
      }),
    ).rejects.toMatchObject({ details: { reason: 'keys_not_configured' } });
  });
  it('talks to the in-process mock end to end for every scenario', async () => {
    const mock = new TrackWizzMock({
      port: 8098,
      theirPrivateKeyPem: key('their_private.pem'),
      ourPublicKeyPem: key('our_public.pem'),
    });
    await mock.start();
    try {
      const gw = new TrackWizzGateway(
        http(),
        cfg({ baseUrl: 'http://127.0.0.1:8098' }),
      );
      const call = (purpose: string) =>
        gw.submit({
          requestId: 'sr_42',
          sourceSystemName: 'WMCPMS',
          purpose,
          customerList: [{ sourceSystemCustomerCode: 'cus_1' }],
        });
      expect(
        (await call('01,04')).response.DecryptedData?.CustomerResponse?.[0]
          .PurposeResponse?.[0].Data?.SuggestedAction,
      ).toBe('Proceed');
      mock.setScenario('CONFIRMED_HIT');
      expect(
        (await call('01,04')).response.DecryptedData?.CustomerResponse?.[0]
          .PurposeResponse?.[0].Data,
      ).toMatchObject({ SuggestedAction: 'Stop', ConfirmedHits: 'Yes' });
      mock.setScenario('RISK_HIGH');
      expect(
        (await call('06')).response.DecryptedData?.CustomerResponse?.[0]
          .PurposeResponse?.[0].Data?.RiskValue,
      ).toBe('High');
      mock.setScenario('REJECT');
      expect((await call('01,04')).response).toMatchObject({
        ValidationCode: 'MRV14',
      });
      mock.setScenario('BAD_SIGNATURE');
      await expect(call('01,04')).rejects.toMatchObject({
        details: { category: 'signature_invalid' },
      });
      expect(mock.requests.map((r) => r.purpose)).toEqual([
        '01,04',
        '01,04',
        '06',
        '01,04',
        '01,04',
      ]);
      const noHeaders = await fetch(
        'http://127.0.0.1:8098/CustomerInfo/as501',
        { method: 'POST', body: '{}' },
      );
      expect(noHeaders.status).toBe(401);
      expect(
        (await fetch('http://127.0.0.1:8098/other', { method: 'POST' })).status,
      ).toBe(404);
    } finally {
      await mock.stop();
    }
  });
});

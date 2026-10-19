import { silentLogger } from '../../../../test/support/fakes';
import { CorrelationStore } from '../../../common/correlation/correlation.store';
import { PartnerRejectedError } from '../../../common/errors/app-error';
import { CircuitBreakerRegistry } from '../../../common/http/circuit-breaker.registry';
import { HttpClientService } from '../../../common/http/http-client.service';
import { parseCasSummary } from '../../../domain/portfolio/cas-parser';
import { MfCentralMock, mockDecrypt } from './mfcentral-mock.server';
import { MfCentralGateway } from './mfcentral.gateway';

const PORT = 4910 + Math.floor(Math.random() * 50);
const gateway = (base: string) =>
  new MfCentralGateway(
    new HttpClientService(
      new CorrelationStore(),
      silentLogger as never,
      new CircuitBreakerRegistry(),
    ),
    {
      mfcentral: {
        baseUrl: base,
        clientId: 'cid',
        clientSecret: 'csec',
        username: 'u',
        password: 'p',
        encryptionKey: 'k',
        privateJwk: '{}',
        timeoutMs: 2000,
        cryptoMode: 'remote',
        appUrl: `${base}/investor`,
        redirectUrl: 'http://localhost:3000/v1/integrations/mfcentral/callback',
        returnUrl: 'http://fe/x',
        importTtlMinutes: 15,
      },
    } as never,
  );

describe('MfCentralMock through the real gateway (remote helper crypto)', () => {
  const mock = new MfCentralMock({ port: PORT });
  beforeAll(() => mock.start());
  afterAll(() => mock.stop());

  it('token → encrypt → sign → newCasRequest → decrypt; investor page; authorise produces a decryptable statement', async () => {
    const gw = gateway(mock.baseUrl);
    const r = await gw.newCasRequest({
      clientRefNo: 'pi_1',
      pan: 'ABCPE1234F',
      mobile: '+919876543210',
      email: 'v@example.com',
      redirectUrl: 'http://localhost:3000/v1/integrations/mfcentral/callback',
    });
    expect(r).toMatchObject({ clientRefNo: 'pi_1', status: undefined });
    expect(r.reqId).toMatch(/^\d{7}$/);
    expect(r.otpRef).toContain('mock-otp-ref');
    expect(mock.calls.map((c) => c.path)).toEqual([
      '/oauth/token',
      '/api/test/encrypt',
      '/api/test/generateSignature',
      '/api/client/V1/newCasRequest',
      '/api/test/decrypt',
    ]);
    const url = gw.buildRedirectUrl(r.reqId!, 'pi_1');
    const page = await fetch(url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('AB••••••4F');
    expect((await fetch(`${mock.baseUrl}/investor?reqId=nope`)).status).toBe(
      404,
    );

    const auth = (await (
      await fetch(`${mock.baseUrl}/mock/requests/pi_1/authorise`, {
        method: 'POST',
        body: JSON.stringify({ outcome: 'APPROVE' }),
      })
    ).json()) as {
      redirectUrl: string;
      fields: { status: string; response: string; reqId: string };
    };
    expect(auth.redirectUrl).toBe(
      'http://localhost:3000/v1/integrations/mfcentral/callback',
    );
    expect(auth.fields).toMatchObject({ status: 'SUCCESS', reqId: r.reqId });
    const plain = await gw.decrypt(auth.fields.response);
    expect(plain).toBe(mockDecrypt(auth.fields.response));
    const parsed = parseCasSummary(JSON.parse(plain), {
      pan: 'ABCPE1234F',
      asOf: new Date(),
    });
    expect(parsed.holdings).toHaveLength(4);
    expect(parsed.totals.marketValueInr).toBeGreaterThan(0);
    expect(parsed.byAssetClass.map((s) => s.assetClass)).toEqual(
      expect.arrayContaining(['EQUITY', 'DEBT', 'HYBRID']),
    );

    // the consent page's decide handler returns an auto-submitting form to the client's redirectUrl
    const decide = await fetch(`${mock.baseUrl}/investor/decide`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `reqId=${r.reqId}&outcome=DECLINE`,
    });
    const html = await decide.text();
    expect(html).toContain(
      'action="http://localhost:3000/v1/integrations/mfcentral/callback"',
    );
    expect(html).toContain('name="status" value="FAILED"');
    expect(
      (
        await fetch(`${mock.baseUrl}/mock/requests/nope/authorise`, {
          method: 'POST',
          body: '{}',
        })
      ).status,
    ).toBe(404);
  });

  it('PAN digits 9999 are rejected like an unwhitelisted PAN on UAT; 0000 gives an empty statement; validateQRCode needs a known reqId', async () => {
    const gw = gateway(mock.baseUrl);
    await expect(
      gw.newCasRequest({
        clientRefNo: 'pi_2',
        pan: 'ABCPE9999F',
        mobile: '+919876543210',
        redirectUrl: 'http://x',
      }),
    ).rejects.toMatchObject({
      vendorCode: '422',
      details: { vendorErrors: [{ code: '422', message: 'Invalid Input' }] },
    });
    const empty = await gw.newCasRequest({
      clientRefNo: 'pi_3',
      pan: 'ABCPE0000F',
      mobile: '+919876543210',
      redirectUrl: 'http://x',
    });
    const auth = mock.authorise(empty.reqId!, 'APPROVE');
    expect(
      parseCasSummary(JSON.parse(mockDecrypt(auth.fields.response!)), {
        pan: 'ABCPE0000F',
        asOf: new Date(),
      }).holdings,
    ).toEqual([]);
    const qr = await gw.validateQrCode({
      clientRefNo: 'pi_3',
      reqId: empty.reqId!,
      qrCode: 'iVBORw0KGgo=',
    });
    expect((qr.raw as { data: { folios: unknown[] } }).data.folios).toEqual([]);
    await expect(
      gw.validateQrCode({ clientRefNo: 'pi_3', reqId: '1', qrCode: 'x' }),
    ).rejects.toBeInstanceOf(PartnerRejectedError);
    expect((await fetch(`${mock.baseUrl}/mock/requests`)).status).toBe(200);
    expect((await fetch(`${mock.baseUrl}/nope`)).status).toBe(404);
    expect(
      (
        await fetch(`${mock.baseUrl}/api/test/encrypt`, {
          method: 'POST',
          body: 'x',
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(`${mock.baseUrl}/oauth/token`, {
          method: 'POST',
          body: 'grant_type=password',
        })
      ).status,
    ).toBe(401);
  });
});

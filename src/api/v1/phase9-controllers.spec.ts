import { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { MfCentralCallbackService } from '../../application/portfolio/mfcentral-callback.service';
import { PortfolioImportService } from '../../application/portfolio/portfolio-import.service';
import { ApplicationOwnershipGuard } from '../../common/auth/application-ownership.guard';
import { SessionGuard } from '../../common/auth/session.guard';
import { CorrelationStore } from '../../common/correlation/correlation.store';
import { NotFoundError } from '../../common/errors/app-error';
import { ErrorEnvelopeFilter } from '../../common/errors/error-envelope.filter';
import { createValidationPipe } from '../../common/validation/validation.pipe';
import { MfCentralCallbackController } from './integrations/mfcentral-callback.controller';
import { PortfolioController } from './onboarding/portfolio.controller';

const base = '/v1/onboarding/applications/app_1';

describe('Phase 9 controllers (mocked services and guards)', () => {
  let app: INestApplication<App>;
  const service = {
    start: jest.fn(),
    get: jest.fn(),
    skip: jest.fn(),
    portfolio: jest.fn(),
    validateQr: jest.fn(),
  };
  const callback = { receive: jest.fn() };
  const asCustomer = {
    canActivate: (ctx: {
      switchToHttp: () => { getRequest: () => { principal?: unknown } };
    }) => {
      ctx.switchToHttp().getRequest().principal = {
        kind: 'CUSTOMER',
        id: 'cus_1',
        applicationIds: ['app_1'],
      };
      return true;
    },
  };

  beforeAll(async () => {
    const logger = { error: jest.fn(), warn: jest.fn(), child: jest.fn() };
    const mod = await Test.createTestingModule({
      controllers: [PortfolioController, MfCentralCallbackController],
      providers: [
        { provide: PortfolioImportService, useValue: service },
        { provide: MfCentralCallbackService, useValue: callback },
        CorrelationStore,
        {
          provide: APP_FILTER,
          useFactory: (s: CorrelationStore) =>
            new ErrorEnvelopeFilter(s, logger as never),
          inject: [CorrelationStore],
        },
        { provide: APP_PIPE, useFactory: createValidationPipe },
      ],
    })
      .overrideGuard(SessionGuard)
      .useValue(asCustomer)
      .overrideGuard(ApplicationOwnershipGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = mod.createNestApplication<App>();
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('start (201) maps the view; consent must be true', async () => {
    service.start.mockResolvedValue({
      importId: 'pi_1',
      status: 'AWAITING_AUTHORISATION',
      authorisationUrl: 'http://mock/investor?reqId=1',
      expiresAt: new Date('2026-10-19T10:15:00Z'),
      nextScreen: 'PORTFOLIO_IMPORT',
    });
    const res = await request(app.getHttpServer())
      .post(`${base}/portfolio-imports`)
      .send({ consent: true })
      .expect(201);
    expect(res.body).toEqual({
      import_id: 'pi_1',
      status: 'AWAITING_AUTHORISATION',
      authorisation_url: 'http://mock/investor?reqId=1',
      expires_at: '2026-10-19T10:15:00.000Z',
      next_screen: 'PORTFOLIO_IMPORT',
    });
    expect(service.start).toHaveBeenCalledWith({
      applicationId: 'app_1',
      customerId: 'cus_1',
      consent: true,
    });
    await request(app.getHttpServer())
      .post(`${base}/portfolio-imports`)
      .send({ consent: false })
      .expect(422);
    await request(app.getHttpServer())
      .post(`${base}/portfolio-imports`)
      .send({})
      .expect(422);
  });

  it('status, skip and dashboard', async () => {
    service.get.mockResolvedValue({
      importId: 'pi_1',
      status: 'FAILED',
      failureCategory: 'invalid_payload',
      nextScreen: 'PORTFOLIO_IMPORT',
    });
    expect(
      (
        await request(app.getHttpServer())
          .get(`${base}/portfolio-imports/pi_1`)
          .expect(200)
      ).body,
    ).toEqual({
      import_id: 'pi_1',
      status: 'FAILED',
      failure_category: 'invalid_payload',
      next_screen: 'PORTFOLIO_IMPORT',
    });
    service.get.mockRejectedValue(new NotFoundError());
    await request(app.getHttpServer())
      .get(`${base}/portfolio-imports/pi_2`)
      .expect(404);
    service.skip.mockResolvedValue({
      status: 'SKIPPED',
      nextScreen: 'KYC_PROGRESS',
    });
    expect(
      (
        await request(app.getHttpServer())
          .post(`${base}/portfolio-imports/skip`)
          .send({})
          .expect(200)
      ).body,
    ).toEqual({
      status: 'SKIPPED',
      next_screen: 'KYC_PROGRESS',
    });
    service.portfolio.mockResolvedValue({
      status: 'AVAILABLE',
      importId: 'pi_1',
      nextScreen: 'CONFIRM_KYC',
      data: {
        source: 'MFCENTRAL',
        asOf: '2026-10-18',
        investor: { name: 'V', panMasked: 'AB••••••4F' },
        totals: {
          marketValueInr: 200,
          costValueInr: 150,
          gainInr: 50,
          gainPct: 33.3,
          folioCount: 1,
          schemeCount: 1,
        },
        byAssetClass: [
          { assetClass: 'EQUITY', marketValueInr: 200, weightPct: 100 },
        ],
        byAmc: [
          { amc: 'A', marketValueInr: 200, weightPct: 100, schemeCount: 1 },
        ],
        holdings: [
          {
            amc: 'A',
            schemeName: 'S',
            schemeType: 'Equity(G)',
            isin: 'INF1',
            folioMasked: '••••4567',
            assetClass: 'EQUITY',
            plan: 'DIRECT',
            units: 10,
            nav: 20,
            navDate: '2026-10-17',
            marketValueInr: 200,
            costValueInr: 150,
            gainInr: 50,
            gainPct: 33.3,
            rta: 'CAMS',
            demat: false,
          },
        ],
        partial: true,
        notice: 'partial',
      },
    });
    const res = await request(app.getHttpServer())
      .get(`${base}/portfolio`)
      .expect(200);
    expect(res.body).toEqual({
      status: 'AVAILABLE',
      import_id: 'pi_1',
      source: 'MFCENTRAL',
      partial: true,
      notice: 'partial',
      as_of: '2026-10-18',
      investor: { name: 'V', pan_masked: 'AB••••••4F' },
      totals: {
        market_value_inr: 200,
        cost_value_inr: 150,
        gain_inr: 50,
        gain_pct: 33.3,
        folio_count: 1,
        scheme_count: 1,
      },
      by_asset_class: [
        { asset_class: 'EQUITY', market_value_inr: 200, weight_pct: 100 },
      ],
      by_amc: [
        { amc: 'A', market_value_inr: 200, weight_pct: 100, scheme_count: 1 },
      ],
      holdings: [
        {
          amc: 'A',
          scheme_name: 'S',
          scheme_type: 'Equity(G)',
          isin: 'INF1',
          folio_masked: '••••4567',
          asset_class: 'EQUITY',
          plan: 'DIRECT',
          units: 10,
          nav: 20,
          nav_date: '2026-10-17',
          market_value_inr: 200,
          cost_value_inr: 150,
          gain_inr: 50,
          gain_pct: 33.3,
          rta: 'CAMS',
          demat: false,
        },
      ],
      next_screen: 'CONFIRM_KYC',
    });
    service.portfolio.mockResolvedValue({
      status: 'NOT_AVAILABLE',
      nextScreen: 'PORTFOLIO_IMPORT',
    });
    expect(
      (await request(app.getHttpServer()).get(`${base}/portfolio`).expect(200))
        .body,
    ).toEqual({
      status: 'NOT_AVAILABLE',
      source: 'MFCENTRAL',
      next_screen: 'PORTFOLIO_IMPORT',
    });
  });

  it('QR upload (200) accepts base64 JSON or a multipart file and validates the body', async () => {
    service.validateQr.mockResolvedValue({
      importId: 'pi_1',
      status: 'IMPORTED',
      nextScreen: 'ASSETS_DASHBOARD',
    });
    const qr = 'A'.repeat(120);
    const res = await request(app.getHttpServer())
      .post(`${base}/portfolio-imports/pi_1/qr-validations`)
      .set('Idempotency-Key', 'k-qr-1')
      .send({ qr_code: qr })
      .expect(200);
    expect(res.body).toEqual({
      import_id: 'pi_1',
      status: 'IMPORTED',
      next_screen: 'ASSETS_DASHBOARD',
    });
    expect(service.validateQr).toHaveBeenCalledWith({
      applicationId: 'app_1',
      customerId: 'cus_1',
      importId: 'pi_1',
      qrCode: qr,
    });
    // multipart variant: the PNG itself, base64-encoded by the backend
    const png = Buffer.from('\x89PNG\r\n\x1a\n' + 'x'.repeat(200), 'latin1');
    service.validateQr.mockClear();
    await request(app.getHttpServer())
      .post(`${base}/portfolio-imports/pi_1/qr-validations`)
      .set('Idempotency-Key', 'k-qr-2')
      .attach('qr_image', png, 'qr.png')
      .expect(200);
    expect(service.validateQr).toHaveBeenCalledWith(
      expect.objectContaining({ qrCode: png.toString('base64') }),
    );
    await request(app.getHttpServer())
      .post(`${base}/portfolio-imports/pi_1/qr-validations`)
      .set('Idempotency-Key', 'k-qr-3')
      .send({ qr_code: 'short' })
      .expect(422);
    await request(app.getHttpServer())
      .post(`${base}/portfolio-imports/pi_1/qr-validations`)
      .set('Idempotency-Key', 'k-qr-4')
      .send({})
      .expect(422);
  });

  it('callback accepts a form POST or GET without a session and redirects', async () => {
    callback.receive.mockResolvedValue({
      redirectTo: 'http://fe.test/x?import_id=pi_1&status=received',
      importId: 'pi_1',
      duplicate: false,
    });
    const post = await request(app.getHttpServer())
      .post('/v1/integrations/mfcentral/callback?extra=1')
      .type('form')
      .send({
        reqId: '1',
        clientRefNo: 'pi_1',
        status: 'SUCCESS',
        response: 'CIPHER',
      })
      .expect(302);
    expect(post.headers.location).toBe(
      'http://fe.test/x?import_id=pi_1&status=received',
    );
    expect(callback.receive).toHaveBeenCalledWith({
      extra: '1',
      reqId: '1',
      clientRefNo: 'pi_1',
      status: 'SUCCESS',
      response: 'CIPHER',
    });
    await request(app.getHttpServer())
      .get(
        '/v1/integrations/mfcentral/callback?reqId=1&clientRefNo=pi_1&status=FAILED',
      )
      .expect(302);
    expect(callback.receive).toHaveBeenLastCalledWith({
      reqId: '1',
      clientRefNo: 'pi_1',
      status: 'FAILED',
    });
  });
});

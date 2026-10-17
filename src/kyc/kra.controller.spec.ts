import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  DigioApiError,
  DigioValidationError,
} from '../connectors/digio/digio.errors';
import { DigioKraConnector } from '../connectors/digio/kra/kra.connector';
import { KraController } from './kra.controller';

describe('KraController', () => {
  let app: INestApplication<App>;
  const kra = {
    checkPanStatus: jest.fn(),
    fetchDetails: jest.fn(),
    uploadDetails: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [KraController],
      providers: [{ provide: DigioKraConnector, useValue: kra }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());
  beforeEach(() => jest.resetAllMocks());

  it('POST /kyc/kra/pan-status forwards body and X-Reference-Id', async () => {
    kra.checkPanStatus.mockResolvedValue({ status_code: '007' });

    await request(app.getHttpServer())
      .post('/kyc/kra/pan-status')
      .set('X-Reference-Id', 'trace-1')
      .send({ pan_no: 'ABJPM6976J' })
      .expect(201, { status_code: '007' });

    expect(kra.checkPanStatus).toHaveBeenCalledWith(
      { pan_no: 'ABJPM6976J' },
      { referenceId: 'trace-1' },
    );
  });

  it('POST /kyc/kra/details?deserialize_codes=true passes the flag', async () => {
    kra.fetchDetails.mockResolvedValue({ application_type: 'I' });

    await request(app.getHttpServer())
      .post('/kyc/kra/details?deserialize_codes=true')
      .send({ pan_no: 'ABJPM6976J', dob: '16/08/1955' })
      .expect(201);

    expect(kra.fetchDetails).toHaveBeenCalledWith(
      { pan_no: 'ABJPM6976J', dob: '16/08/1955' },
      { referenceId: undefined, deserializeCodes: true },
    );
  });

  it('POST /kyc/kra/upload forwards the registration payload', async () => {
    kra.uploadDetails.mockResolvedValue({ status: 'SUBMITTED' });

    await request(app.getHttpServer())
      .post('/kyc/kra/upload')
      .send({ common_kra_registration_request: { pan_no: 'WLMPT9867F' } })
      .expect(201, { status: 'SUBMITTED' });
  });

  it('maps DigioValidationError to 400', async () => {
    kra.checkPanStatus.mockRejectedValue(
      new DigioValidationError('pan_no must be a valid PAN', 'pan_no'),
    );

    const res = await request(app.getHttpServer())
      .post('/kyc/kra/pan-status')
      .send({ pan_no: 'bad' })
      .expect(400);
    expect(res.body).toMatchObject({ field: 'pan_no' });
  });

  it('maps a Digio 4xx DigioApiError to 502 with Digio details', async () => {
    kra.checkPanStatus.mockRejectedValue(
      new DigioApiError(
        'Digio failed',
        401,
        'UNAUTHORIZED',
        'EX1',
        { x: 1 },
        'r',
        '/p',
      ),
    );

    const res = await request(app.getHttpServer())
      .post('/kyc/kra/pan-status')
      .send({ pan_no: 'ABJPM6976J' })
      .expect(502);
    expect((res.body as { digio: unknown }).digio).toMatchObject({
      httpStatus: 401,
      code: 'UNAUTHORIZED',
    });
  });

  it('maps a transport DigioApiError to 504', async () => {
    kra.checkPanStatus.mockRejectedValue(
      new DigioApiError(
        'timeout',
        undefined,
        'ECONNABORTED',
        undefined,
        undefined,
        'r',
        '/p',
      ),
    );

    await request(app.getHttpServer())
      .post('/kyc/kra/pan-status')
      .send({ pan_no: 'ABJPM6976J' })
      .expect(504);
  });
});

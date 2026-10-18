import { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { FeesService } from '../../application/fees/fees.service';
import { ReviewService } from '../../application/review/review.service';
import { SuitabilityService } from '../../application/suitability/suitability.service';
import { ApplicationOwnershipGuard } from '../../common/auth/application-ownership.guard';
import { SessionGuard } from '../../common/auth/session.guard';
import { CorrelationStore } from '../../common/correlation/correlation.store';
import { StaleVersionError } from '../../common/errors/app-error';
import { ErrorEnvelopeFilter } from '../../common/errors/error-envelope.filter';
import { createValidationPipe } from '../../common/validation/validation.pipe';
import { SuitabilityFeesReviewController } from './onboarding/phase5.controller';

const errorCode = (res: { body: unknown }): string =>
  (res.body as { error: { code: string } }).error.code;
const base = '/v1/onboarding/applications/app_1';

describe('Phase 5 controllers (mocked services and guards)', () => {
  let app: INestApplication<App>;
  const suitability = { assess: jest.fn(), confirmApproach: jest.fn() };
  const fees = { illustrate: jest.fn(), acknowledge: jest.fn() };
  const review = { get: jest.fn(), confirm: jest.fn() };
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
      controllers: [SuitabilityFeesReviewController],
      providers: [
        { provide: SuitabilityService, useValue: suitability },
        { provide: FeesService, useValue: fees },
        { provide: ReviewService, useValue: review },
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

  it('POST suitability-assessments maps answers and ignores any client score field', async () => {
    suitability.assess.mockResolvedValue({
      assessmentId: 'sa_1',
      status: 'INCOMPLETE',
      missingQuestionIds: ['LIQUIDITY'],
      nextScreen: 'INVESTMENT_PROFILE',
    });
    const res = await request(app.getHttpServer())
      .post(`${base}/suitability-assessments`)
      .send({
        questionnaire_version: 'suitability_v1',
        answers: [{ question_id: 'OBJECTIVE', answer_id: 'LONG_TERM_GROWTH' }],
      })
      .expect(200);
    expect(res.body).toEqual({
      assessment_id: 'sa_1',
      status: 'INCOMPLETE',
      missing_question_ids: ['LIQUIDITY'],
      next_screen: 'INVESTMENT_PROFILE',
    });
    expect(suitability.assess).toHaveBeenCalledWith({
      applicationId: 'app_1',
      customerId: 'cus_1',
      questionnaireVersion: 'suitability_v1',
      answers: [{ questionId: 'OBJECTIVE', answerId: 'LONG_TERM_GROWTH' }],
    });
    await request(app.getHttpServer())
      .post(`${base}/suitability-assessments`)
      .send({ questionnaire_version: 'suitability_v1', answers: [], score: 20 })
      .expect(422);
    await request(app.getHttpServer())
      .post(`${base}/suitability-assessments`)
      .send({
        questionnaire_version: 'suitability_v1',
        answers: [{ question_id: 'OBJECTIVE' }],
      })
      .expect(422);
    expect(suitability.assess).toHaveBeenCalledTimes(1);
  });

  it('PUT investment-approach maps the body; stale assessment surfaces as 409', async () => {
    suitability.confirmApproach.mockResolvedValue({
      status: 'CONFIRMED',
      approachVersion: 1,
      nextScreen: 'FEES_DISCLOSURES',
    });
    const res = await request(app.getHttpServer())
      .put(`${base}/investment-approach`)
      .send({
        assessment_id: 'sa_1',
        assessment_version: 1,
        approach_code: 'EQUITY_GROWTH',
        confirmed: true,
      })
      .expect(200);
    expect(res.body).toEqual({
      status: 'CONFIRMED',
      approach_version: 1,
      next_screen: 'FEES_DISCLOSURES',
    });
    expect(suitability.confirmApproach).toHaveBeenCalledWith({
      applicationId: 'app_1',
      customerId: 'cus_1',
      assessmentId: 'sa_1',
      assessmentVersion: 1,
      approachCode: 'EQUITY_GROWTH',
      confirmed: true,
    });
    suitability.confirmApproach.mockRejectedValue(new StaleVersionError());
    const stale = await request(app.getHttpServer())
      .put(`${base}/investment-approach`)
      .send({
        assessment_id: 'sa_1',
        assessment_version: 1,
        approach_code: 'EQUITY_GROWTH',
        confirmed: true,
      })
      .expect(409);
    expect(errorCode(stale)).toBe('STALE_VERSION');
    await request(app.getHttpServer())
      .put(`${base}/investment-approach`)
      .send({
        assessment_id: 'sa_1',
        assessment_version: 0,
        approach_code: 'EQUITY_GROWTH',
        confirmed: 'yes',
      })
      .expect(422);
  });

  it('fee illustrations and acknowledgements map in and out', async () => {
    fees.illustrate.mockResolvedValue({
      status: 'CALCULATED',
      illustrationId: 'fi_1',
      lineItems: [{ code: 'GROSS_RETURN', amountInr: 500000 }],
      disclaimerVersion: 'illustration_v1',
    });
    const ill = await request(app.getHttpServer())
      .post(`${base}/fee-illustrations`)
      .send({
        approach_code: 'EQUITY_GROWTH',
        fee_schedule_version: 'fees_v1',
        scenario_code: 'RETURN_PLUS_10',
      })
      .expect(200);
    expect(ill.body).toEqual({
      status: 'CALCULATED',
      illustration_id: 'fi_1',
      line_items: [{ code: 'GROSS_RETURN', amount_inr: 500000 }],
      disclaimer_version: 'illustration_v1',
    });
    expect(fees.illustrate).toHaveBeenCalledWith({
      applicationId: 'app_1',
      customerId: 'cus_1',
      approachCode: 'EQUITY_GROWTH',
      feeScheduleVersion: 'fees_v1',
      scenarioCode: 'RETURN_PLUS_10',
    });
    fees.acknowledge.mockResolvedValue({
      status: 'RECORDED',
      feeAnnexureExecutionRequired: true,
      nextScreen: 'APPLICATION_REVIEW',
    });
    const ack = await request(app.getHttpServer())
      .post(`${base}/acknowledgements`)
      .send({
        document_pack_version: 1,
        acknowledgements: [
          {
            document_type: 'DISCLOSURE',
            document_version: 'disclosure_v1',
            acknowledged: true,
          },
        ],
        fee_understanding_note: 'I understand the fees apply yearly.',
      })
      .expect(200);
    expect(ack.body).toEqual({
      status: 'RECORDED',
      fee_annexure_execution_required: true,
      next_screen: 'APPLICATION_REVIEW',
    });
    expect(fees.acknowledge).toHaveBeenCalledWith({
      applicationId: 'app_1',
      customerId: 'cus_1',
      documentPackVersion: 1,
      acknowledgements: [
        {
          documentType: 'DISCLOSURE',
          documentVersion: 'disclosure_v1',
          acknowledged: true,
        },
      ],
      feeUnderstandingNote: 'I understand the fees apply yearly.',
    });
    await request(app.getHttpServer())
      .post(`${base}/acknowledgements`)
      .send({
        document_pack_version: 1,
        acknowledgements: [],
        fee_understanding_note: 'x',
      })
      .expect(422);
    expect(fees.acknowledge).toHaveBeenCalledTimes(1);
  });

  it('review summary and confirmation', async () => {
    review.get.mockResolvedValue({
      applicationVersion: 12,
      documentPackVersion: 1,
      ready: true,
      blockers: [],
      sections: { identity: { panMasked: 'AB••••••4F' } },
    });
    const s = await request(app.getHttpServer())
      .get(`${base}/review`)
      .expect(200);
    expect(s.body).toEqual({
      application_version: 12,
      document_pack_version: 1,
      ready: true,
      blockers: [],
      sections: { identity: { panMasked: 'AB••••••4F' } },
    });
    expect(review.get).toHaveBeenCalledWith('app_1', 'cus_1');
    review.confirm.mockResolvedValue({
      status: 'CONFIRMED',
      snapshotId: 'snap_1',
      nextScreen: 'SIGN_DOCUMENTS',
    });
    const c = await request(app.getHttpServer())
      .post(`${base}/review-confirmations`)
      .send({
        application_version: 12,
        document_pack_version: 1,
        details_confirmed: true,
      })
      .expect(200);
    expect(c.body).toEqual({
      status: 'CONFIRMED',
      snapshot_id: 'snap_1',
      next_screen: 'SIGN_DOCUMENTS',
    });
    expect(review.confirm).toHaveBeenCalledWith({
      applicationId: 'app_1',
      customerId: 'cus_1',
      applicationVersion: 12,
      documentPackVersion: 1,
      detailsConfirmed: true,
    });
    await request(app.getHttpServer())
      .post(`${base}/review-confirmations`)
      .send({
        application_version: 'twelve',
        document_pack_version: 1,
        details_confirmed: true,
      })
      .expect(422);
  });
});

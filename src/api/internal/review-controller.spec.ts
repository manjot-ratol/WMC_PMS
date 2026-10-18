import { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { BackOfficeReviewService } from '../../application/back-office/back-office-review.service';
import { InternalServiceGuard } from '../../common/auth/internal-service.guard';
import { ReviewerGuard } from '../../common/auth/reviewer.guard';
import { UnauthenticatedError } from '../../common/errors/app-error';
import { CorrelationStore } from '../../common/correlation/correlation.store';
import { ErrorEnvelopeFilter } from '../../common/errors/error-envelope.filter';
import { createValidationPipe } from '../../common/validation/validation.pipe';
import { ReviewController } from './review.controller';

const errorCode = (res: { body: unknown }): string =>
  (res.body as { error: { code: string } }).error.code;

describe('ReviewController + ReviewerGuard', () => {
  let app: INestApplication<App>;
  const svc = {
    listCases: jest.fn(),
    listTasks: jest.fn(),
    decide: jest.fn(),
    acceptBankEvidence: jest.fn(),
    resolveTask: jest.fn(),
  };
  const internal = { canActivate: jest.fn().mockReturnValue(true) };
  beforeAll(async () => {
    const logger = { error: jest.fn(), warn: jest.fn(), child: jest.fn() };
    const mod = await Test.createTestingModule({
      controllers: [ReviewController],
      providers: [
        { provide: BackOfficeReviewService, useValue: svc },
        { provide: InternalServiceGuard, useValue: internal },
        ReviewerGuard,
        CorrelationStore,
        {
          provide: APP_FILTER,
          useFactory: (s: CorrelationStore) =>
            new ErrorEnvelopeFilter(s, logger as never),
          inject: [CorrelationStore],
        },
        { provide: APP_PIPE, useFactory: createValidationPipe },
      ],
    }).compile();
    app = mod.createNestApplication<App>();
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('requires a well-formed X-Reviewer-Id on top of the service token; nothing is written without it', async () => {
    const res = await request(app.getHttpServer())
      .post('/internal/v1/review/cases/case_1/decisions')
      .send({ decision: 'PROCEED', reason: 'Reviewed and cleared.' })
      .expect(401);
    expect(errorCode(res)).toBe('UNAUTHENTICATED');
    await request(app.getHttpServer())
      .post('/internal/v1/review/cases/case_1/decisions')
      .set('X-Reviewer-Id', 'bad id with spaces')
      .send({ decision: 'PROCEED', reason: 'Reviewed and cleared.' })
      .expect(401);
    expect(svc.decide).not.toHaveBeenCalled();
    internal.canActivate.mockImplementationOnce(() => {
      throw new UnauthenticatedError();
    });
    await request(app.getHttpServer())
      .get('/internal/v1/review/cases')
      .set('X-Reviewer-Id', 'rev-1')
      .expect(401);
  });
  it('lists cases and tasks with parsed status filters', async () => {
    svc.listCases.mockResolvedValue([
      {
        caseId: 'case_1',
        applicationId: 'app_1',
        kind: 'SCREENING_HIT',
        severity: 'HIGH',
        status: 'OPEN',
        sourceRunId: 'sr_1',
        providerCaseId: 'C1',
        summary: { hitsCount: 2 },
        createdAt: new Date('2026-10-18T00:00:00Z'),
      },
    ]);
    const c = await request(app.getHttpServer())
      .get('/internal/v1/review/cases')
      .set('X-Reviewer-Id', 'rev-1')
      .expect(200);
    expect(c.body).toEqual([
      {
        case_id: 'case_1',
        application_id: 'app_1',
        kind: 'SCREENING_HIT',
        severity: 'HIGH',
        status: 'OPEN',
        source_run_id: 'sr_1',
        provider_case_id: 'C1',
        summary: { hitsCount: 2 },
        created_at: '2026-10-18T00:00:00.000Z',
      },
    ]);
    expect(svc.listCases).toHaveBeenCalledWith(['OPEN'], 50);
    await request(app.getHttpServer())
      .get('/internal/v1/review/cases?status=under_review,closed&limit=5')
      .set('X-Reviewer-Id', 'rev-1')
      .expect(200);
    expect(svc.listCases).toHaveBeenLastCalledWith(
      ['UNDER_REVIEW', 'CLOSED'],
      5,
    );
    await request(app.getHttpServer())
      .get('/internal/v1/review/cases?status=WHATEVER')
      .set('X-Reviewer-Id', 'rev-1')
      .expect(422);
    svc.listTasks.mockResolvedValue([
      {
        taskId: 't1',
        applicationId: 'app_1',
        category: 'FUNDING_REVIEW',
        status: 'OPEN',
        customerVisible: false,
        createdAt: new Date('2026-10-18T00:00:00Z'),
      },
    ]);
    const t = await request(app.getHttpServer())
      .get('/internal/v1/review/tasks')
      .set('X-Reviewer-Id', 'rev-1')
      .expect(200);
    expect(t.body).toEqual([
      {
        task_id: 't1',
        application_id: 'app_1',
        category: 'FUNDING_REVIEW',
        status: 'OPEN',
        customer_visible: false,
        created_at: '2026-10-18T00:00:00.000Z',
      },
    ]);
    expect(svc.listTasks).toHaveBeenCalledWith(['OPEN', 'UNDER_REVIEW'], 50);
  });
  it('decisions, bank evidence and task resolutions carry the reviewer id and validate bodies', async () => {
    svc.decide.mockResolvedValue({
      caseId: 'case_1',
      caseStatus: 'CLOSED',
      decisionId: 'rd_1',
    });
    const d = await request(app.getHttpServer())
      .post('/internal/v1/review/cases/case_1/decisions')
      .set('X-Reviewer-Id', 'rev-1')
      .send({ decision: 'PROCEED', reason: 'Reviewed and cleared.' })
      .expect(200);
    expect(d.body).toEqual({
      case_id: 'case_1',
      case_status: 'CLOSED',
      decision_id: 'rd_1',
    });
    expect(svc.decide).toHaveBeenCalledWith({
      caseId: 'case_1',
      reviewerId: 'rev-1',
      decision: 'PROCEED',
      reason: 'Reviewed and cleared.',
    });
    await request(app.getHttpServer())
      .post('/internal/v1/review/cases/case_1/decisions')
      .set('X-Reviewer-Id', 'rev-1')
      .send({ decision: 'MAYBE', reason: 'Reviewed and cleared.' })
      .expect(422);
    await request(app.getHttpServer())
      .post('/internal/v1/review/cases/case_1/decisions')
      .set('X-Reviewer-Id', 'rev-1')
      .send({ decision: 'PROCEED', reason: 'short' })
      .expect(422);
    svc.acceptBankEvidence.mockResolvedValue({
      verificationId: 'bv_1',
      status: 'VERIFIED',
    });
    const b = await request(app.getHttpServer())
      .post('/internal/v1/review/applications/app_1/bank-evidence')
      .set('X-Reviewer-Id', 'rev-1')
      .send({ verification_id: 'bv_1', reason: 'Cancelled cheque matches.' })
      .expect(200);
    expect(b.body).toEqual({ verification_id: 'bv_1', status: 'VERIFIED' });
    expect(svc.acceptBankEvidence).toHaveBeenCalledWith({
      applicationId: 'app_1',
      verificationId: 'bv_1',
      reviewerId: 'rev-1',
      reason: 'Cancelled cheque matches.',
    });
    svc.resolveTask.mockResolvedValue({ taskId: 't1', status: 'RESOLVED' });
    const r = await request(app.getHttpServer())
      .post('/internal/v1/review/tasks/t1/resolution')
      .set('X-Reviewer-Id', 'rev-1')
      .send({ resolution: 'RESOLVED', reason: 'Receipt matched manually.' })
      .expect(200);
    expect(r.body).toEqual({ task_id: 't1', status: 'RESOLVED' });
    await request(app.getHttpServer())
      .post('/internal/v1/review/tasks/t1/resolution')
      .set('X-Reviewer-Id', 'rev-1')
      .send({ resolution: 'DELETE', reason: 'Receipt matched manually.' })
      .expect(422);
  });
});

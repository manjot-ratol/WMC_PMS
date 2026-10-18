import { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AccountOpeningService } from '../../application/account-opening/account-opening.service';
import { FundingService } from '../../application/funding/funding.service';
import { ProcessingService } from '../../application/processing/processing.service';
import { SigningService } from '../../application/signing/signing.service';
import { ApplicationOwnershipGuard } from '../../common/auth/application-ownership.guard';
import { InternalServiceGuard } from '../../common/auth/internal-service.guard';
import { SessionGuard } from '../../common/auth/session.guard';
import { CorrelationStore } from '../../common/correlation/correlation.store';
import {
  StaleVersionError,
  ValidationError,
} from '../../common/errors/app-error';
import { ErrorEnvelopeFilter } from '../../common/errors/error-envelope.filter';
import { createValidationPipe } from '../../common/validation/validation.pipe';
import { InternalOperationsController } from '../internal/internal-operations.controller';
import {
  FundingController,
  SigningProcessingController,
} from './onboarding/phase6.controller';

const errorCode = (res: { body: unknown }): string =>
  (res.body as { error: { code: string } }).error.code;
const base = '/v1/onboarding/applications/app_1';
const internal = '/internal/v1/applications/app_1';

describe('Phase 6 controllers (mocked services and guards)', () => {
  let app: INestApplication<App>;
  const signing = { create: jest.fn(), get: jest.fn() };
  const processing = { status: jest.fn(), respond: jest.fn() };
  const funding = {
    instructions: jest.fn(),
    notify: jest.fn(),
    status: jest.fn(),
    completion: jest.fn(),
    recordReceipt: jest.fn(),
  };
  const accounts = {
    requestRun: jest.fn(),
    recordUnderlyingAccount: jest.fn(),
  };
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
      controllers: [
        SigningProcessingController,
        FundingController,
        InternalOperationsController,
      ],
      providers: [
        { provide: SigningService, useValue: signing },
        { provide: ProcessingService, useValue: processing },
        { provide: FundingService, useValue: funding },
        { provide: AccountOpeningService, useValue: accounts },
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
      .overrideGuard(InternalServiceGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = mod.createNestApplication<App>();
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('signing session create (201) and status; stale snapshot is 409', async () => {
    signing.create.mockResolvedValue({
      signingSessionId: 'ss_1',
      status: 'REQUESTED',
      providerRequestId: 'DID1',
      sdkLaunch: { accessToken: 'GWT1' },
    });
    const res = await request(app.getHttpServer())
      .post(`${base}/signing-sessions`)
      .send({
        snapshot_id: 'snap_1',
        document_pack_version: 1,
        signing_method: 'AADHAAR_ESIGN',
      })
      .expect(201);
    expect(res.body).toEqual({
      signing_session_id: 'ss_1',
      status: 'REQUESTED',
      provider_request_id: 'DID1',
      sdk_launch: { access_token: 'GWT1' },
    });
    expect(signing.create).toHaveBeenCalledWith({
      applicationId: 'app_1',
      customerId: 'cus_1',
      snapshotId: 'snap_1',
      documentPackVersion: 1,
      signingMethod: 'AADHAAR_ESIGN',
    });
    signing.create.mockRejectedValue(new StaleVersionError());
    expect(
      errorCode(
        await request(app.getHttpServer())
          .post(`${base}/signing-sessions`)
          .send({
            snapshot_id: 'snap_0',
            document_pack_version: 1,
            signing_method: 'AADHAAR_ESIGN',
          })
          .expect(409),
      ),
    ).toBe('STALE_VERSION');
    await request(app.getHttpServer())
      .post(`${base}/signing-sessions`)
      .send({
        snapshot_id: 'snap_1',
        document_pack_version: 1,
        signing_method: 'WET_INK',
      })
      .expect(422);
    signing.get.mockResolvedValue({
      status: 'EXECUTED',
      documentPackVersion: 1,
      evidenceAvailable: true,
      nextScreen: 'APPLICATION_PROCESSING',
    });
    const s = await request(app.getHttpServer())
      .get(`${base}/signing-sessions/ss_1`)
      .expect(200);
    expect(s.body).toEqual({
      status: 'EXECUTED',
      document_pack_version: 1,
      evidence_available: true,
      next_screen: 'APPLICATION_PROCESSING',
    });
    expect(signing.get).toHaveBeenCalledWith('app_1', 'cus_1', 'ss_1');
  });

  it('processing status and task responses', async () => {
    processing.status.mockResolvedValue({
      applicationStatus: 'PROCESSING',
      tasks: [
        { taskId: 't1', category: 'ACCOUNT_SETUP', status: 'IN_PROGRESS' },
      ],
      customerActionRequired: false,
      nextScreen: 'APPLICATION_PROCESSING',
    });
    const s = await request(app.getHttpServer())
      .get(`${base}/status`)
      .expect(200);
    expect(s.body).toEqual({
      application_status: 'PROCESSING',
      tasks: [
        { task_id: 't1', category: 'ACCOUNT_SETUP', status: 'IN_PROGRESS' },
      ],
      customer_action_required: false,
      next_screen: 'APPLICATION_PROCESSING',
    });
    processing.respond.mockResolvedValue({
      status: 'SUBMITTED',
      taskStatus: 'UNDER_REVIEW',
    });
    const r = await request(app.getHttpServer())
      .post(`${base}/tasks/t1/responses`)
      .send({ response_type: 'DOCUMENT', document_ids: ['doc_1'] })
      .expect(200);
    expect(r.body).toEqual({
      status: 'SUBMITTED',
      task_status: 'UNDER_REVIEW',
    });
    expect(processing.respond).toHaveBeenCalledWith({
      applicationId: 'app_1',
      customerId: 'cus_1',
      taskId: 't1',
      responseType: 'DOCUMENT',
      documentIds: ['doc_1'],
      text: undefined,
    });
    await request(app.getHttpServer())
      .post(`${base}/tasks/t1/responses`)
      .send({ response_type: 'PHOTO' })
      .expect(422);
  });

  it('funding instructions, notifications, status and completion', async () => {
    funding.instructions.mockResolvedValue({
      status: 'READY',
      instructionsVersion: 1,
      beneficiaryDetails: {
        accountName: 'POOL',
        accountNumberMasked: '••••9012',
        ifsc: 'SBIN0000001',
        bankName: 'SBI',
      },
      paymentReference: 'PMS-1',
      requiredAmountInr: 5000000,
    });
    const i = await request(app.getHttpServer())
      .get(`${base}/funding-instructions`)
      .expect(200);
    expect(i.body).toEqual({
      status: 'READY',
      instructions_version: 1,
      beneficiary_details: {
        account_name: 'POOL',
        account_number_masked: '••••9012',
        ifsc: 'SBIN0000001',
        bank_name: 'SBI',
      },
      payment_reference: 'PMS-1',
      required_amount_inr: 5000000,
    });
    funding.instructions.mockRejectedValue(new ValidationError());
    expect(
      errorCode(
        await request(app.getHttpServer())
          .get(`${base}/funding-instructions`)
          .expect(422),
      ),
    ).toBe('ACTION_REQUIRED');
    funding.notify.mockResolvedValue({
      status: 'AWAITING_RECONCILIATION',
      notificationId: 'fn_1',
      nextScreen: 'FUNDING_STATUS',
    });
    const n = await request(app.getHttpServer())
      .post(`${base}/funding-notifications`)
      .send({
        funding_method: 'BANK_TRANSFER',
        customer_transfer_reference: 'UTR1234',
      })
      .expect(202);
    expect(n.body).toEqual({
      status: 'AWAITING_RECONCILIATION',
      notification_id: 'fn_1',
      next_screen: 'FUNDING_STATUS',
    });
    await request(app.getHttpServer())
      .post(`${base}/funding-notifications`)
      .send({
        funding_method: 'BANK_TRANSFER',
        customer_transfer_reference: 'x',
      })
      .expect(422);
    funding.status.mockResolvedValue({
      fundingStatus: 'RECONCILED',
      activationStatus: 'READY_FOR_ACTIVATION',
      customerActionRequired: false,
      nextScreen: 'ACTIVATION_PROGRESS',
    });
    expect(
      (
        await request(app.getHttpServer())
          .get(`${base}/funding-status`)
          .expect(200)
      ).body,
    ).toEqual({
      funding_status: 'RECONCILED',
      activation_status: 'READY_FOR_ACTIVATION',
      customer_action_required: false,
      next_screen: 'ACTIVATION_PROGRESS',
    });
    funding.completion.mockResolvedValue({
      applicationStatus: 'ACTIVE',
      pmsAccountId: 'PMS1',
      onboardingComplete: true,
      firstInvestmentStatus: 'NOT_STARTED',
      nextScreen: 'PORTFOLIO',
    });
    expect(
      (await request(app.getHttpServer()).get(`${base}/completion`).expect(200))
        .body,
    ).toEqual({
      application_status: 'ACTIVE',
      pms_account_id: 'PMS1',
      onboarding_complete: true,
      first_investment_status: 'NOT_STARTED',
      next_screen: 'PORTFOLIO',
    });
  });

  it('internal feeds map bodies and are 202', async () => {
    accounts.requestRun.mockResolvedValue({ runId: 'ao_1', status: 'QUEUED' });
    const r = await request(app.getHttpServer())
      .post(`${internal}/account-opening-runs`)
      .set('X-Reviewer-Id', 'ops-1')
      .send({ snapshot_id: 'snap_1', document_pack_version: 1 })
      .expect(202);
    expect(r.body).toEqual({ run_id: 'ao_1', status: 'QUEUED' });
    expect(accounts.requestRun).toHaveBeenCalledWith({
      applicationId: 'app_1',
      snapshotId: 'snap_1',
      documentPackVersion: 1,
      requestedBy: 'ops-1',
    });
    accounts.recordUnderlyingAccount.mockResolvedValue({
      accountId: 'ua_1',
      status: 'RECORDED',
      accountsReady: false,
    });
    const u = await request(app.getHttpServer())
      .post(`${internal}/underlying-accounts`)
      .send({
        provider_receipt_key: 'k1',
        provider: 'CUSTODIAN',
        account_type: 'PMS_ACCOUNT',
        account_reference: 'PMS1',
        status: 'READY',
      })
      .expect(202);
    expect(u.body).toEqual({
      account_id: 'ua_1',
      status: 'RECORDED',
      accounts_ready: false,
    });
    await request(app.getHttpServer())
      .post(`${internal}/underlying-accounts`)
      .send({
        provider_receipt_key: 'k1',
        provider: 'CUSTODIAN',
        account_type: 'PMS_ACCOUNT',
        account_reference: 'PMS1',
        status: 'MAYBE',
      })
      .expect(422);
    funding.recordReceipt.mockResolvedValue({
      receiptId: 'fr_1',
      status: 'RECORDED',
      matchStatus: 'MATCHED',
      fundingStatus: 'RECONCILED',
    });
    const f = await request(app.getHttpServer())
      .post(`${internal}/funding-receipts`)
      .send({
        provider_receipt_key: 'r1',
        provider: 'BANK',
        amount_inr: 5000000,
        currency: 'INR',
        source_account_number: '999912345678',
        destination_reference: 'PMS-1',
        value_date: '2026-10-18',
      })
      .expect(202);
    expect(f.body).toEqual({
      receipt_id: 'fr_1',
      status: 'RECORDED',
      match_status: 'MATCHED',
      funding_status: 'RECONCILED',
    });
    expect(funding.recordReceipt).toHaveBeenCalledWith({
      applicationId: 'app_1',
      providerReceiptKey: 'r1',
      provider: 'BANK',
      amountInr: 5000000,
      currency: 'INR',
      sourceAccountNumber: '999912345678',
      destinationReference: 'PMS-1',
      valueDate: '2026-10-18',
    });
    await request(app.getHttpServer())
      .post(`${internal}/funding-receipts`)
      .send({
        provider_receipt_key: 'r1',
        provider: 'BANK',
        amount_inr: -1,
        currency: 'INR',
        destination_reference: 'PMS-1',
        value_date: '18-10-2026',
      })
      .expect(422);
  });
});

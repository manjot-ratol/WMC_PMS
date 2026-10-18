import { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { BankVerificationService } from '../../application/bank/bank-verification.service';
import { NominationService } from '../../application/nomination/nomination.service';
import { DeclarationsService } from '../../application/profile/declarations.service';
import { ProfileService } from '../../application/profile/profile.service';
import { ApplicationOwnershipGuard } from '../../common/auth/application-ownership.guard';
import { SessionGuard } from '../../common/auth/session.guard';
import { CorrelationStore } from '../../common/correlation/correlation.store';
import { StaleVersionError } from '../../common/errors/app-error';
import { ErrorEnvelopeFilter } from '../../common/errors/error-envelope.filter';
import { createValidationPipe } from '../../common/validation/validation.pipe';
import { ProfileBankNominationController } from './onboarding/phase4.controller';

const errorCode = (res: { body: unknown }): string =>
  (res.body as { error: { code: string } }).error.code;
const base = '/v1/onboarding/applications/app_1';

describe('Phase 4 controllers (mocked services and guards)', () => {
  let app: INestApplication<App>;
  const profile = { save: jest.fn() };
  const declarations = { save: jest.fn() };
  const bank = { start: jest.fn(), get: jest.fn() };
  const nomination = { save: jest.fn() };
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
      controllers: [ProfileBankNominationController],
      providers: [
        { provide: ProfileService, useValue: profile },
        { provide: DeclarationsService, useValue: declarations },
        { provide: BankVerificationService, useValue: bank },
        { provide: NominationService, useValue: nomination },
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

  it('PUT profile maps snake_case in and out; stale version surfaces as 409', async () => {
    profile.save.mockResolvedValue({
      status: 'COMPLETE',
      profileVersion: 1,
      nextScreen: 'TAX_DECLARATIONS',
    });
    const res = await request(app.getHttpServer())
      .put(`${base}/profile`)
      .send({
        occupation: 'PRIVATE_SECTOR',
        annual_income_band: 'INR_10L_25L',
        source_of_funds: ['SALARY'],
        source_of_funds_explanation: 'x',
        profile_version: 0,
      })
      .expect(200);
    expect(res.body).toEqual({
      status: 'COMPLETE',
      profile_version: 1,
      next_screen: 'TAX_DECLARATIONS',
    });
    expect(profile.save).toHaveBeenCalledWith({
      applicationId: 'app_1',
      customerId: 'cus_1',
      occupation: 'PRIVATE_SECTOR',
      annualIncomeBand: 'INR_10L_25L',
      sourceOfFunds: ['SALARY'],
      sourceOfFundsExplanation: 'x',
      profileVersion: 0,
    });
    profile.save.mockRejectedValue(new StaleVersionError());
    const stale = await request(app.getHttpServer())
      .put(`${base}/profile`)
      .send({
        occupation: 'PRIVATE_SECTOR',
        annual_income_band: 'INR_10L_25L',
        source_of_funds: ['SALARY'],
        profile_version: 0,
      })
      .expect(409);
    expect(errorCode(stale)).toBe('STALE_VERSION');
    await request(app.getHttpServer())
      .put(`${base}/profile`)
      .send({
        occupation: 'PRIVATE_SECTOR',
        annual_income_band: 'INR_10L_25L',
        source_of_funds: [],
        profile_version: -1,
      })
      .expect(422);
  });

  it('PUT declarations validates nested residencies and maps nulls', async () => {
    declarations.save.mockResolvedValue({
      status: 'COMPLETE',
      additionalInformationRequired: true,
      nextScreen: 'BANK_DETAILS',
    });
    const res = await request(app.getHttpServer())
      .put(`${base}/declarations`)
      .send({
        tax_residencies: [
          { country: 'IN', tin: 'ABCPE1234F' },
          { country: 'US', tin_unavailable_reason: 'APPLIED_FOR' },
        ],
        pep_declaration: 'PEP',
        declaration_version: 'declarations_v1',
      })
      .expect(200);
    expect(res.body).toEqual({
      status: 'COMPLETE',
      additional_information_required: true,
      next_screen: 'BANK_DETAILS',
    });
    expect(declarations.save).toHaveBeenCalledWith({
      applicationId: 'app_1',
      customerId: 'cus_1',
      taxResidencies: [
        { country: 'IN', tin: 'ABCPE1234F', tinUnavailableReason: null },
        { country: 'US', tin: null, tinUnavailableReason: 'APPLIED_FOR' },
      ],
      pepDeclaration: 'PEP',
      declarationVersion: 'declarations_v1',
    });
    await request(app.getHttpServer())
      .put(`${base}/declarations`)
      .send({
        tax_residencies: [{ country: 'IND' }],
        pep_declaration: 'MAYBE',
        declaration_version: 'v',
      })
      .expect(422);
    expect(declarations.save).toHaveBeenCalledTimes(1);
  });

  it('bank verification start is 202 and the read maps the view', async () => {
    bank.start.mockResolvedValue({
      verificationId: 'bv_1',
      status: 'PROCESSING',
      nextScreen: 'BANK_PROGRESS',
    });
    const res = await request(app.getHttpServer())
      .post(`${base}/bank-verifications`)
      .send({
        account_number: '999912345678',
        account_number_confirmation: '999912345678',
        ifsc: 'HDFC0001234',
        holder_name: 'Vinod Kumar Singh',
      })
      .expect(202);
    expect(res.body).toEqual({
      verification_id: 'bv_1',
      status: 'PROCESSING',
      next_screen: 'BANK_PROGRESS',
    });
    expect(bank.start).toHaveBeenCalledWith({
      applicationId: 'app_1',
      customerId: 'cus_1',
      accountNumber: '999912345678',
      accountNumberConfirmation: '999912345678',
      ifsc: 'HDFC0001234',
      holderName: 'Vinod Kumar Singh',
    });
    await request(app.getHttpServer())
      .post(`${base}/bank-verifications`)
      .send({
        account_number: '1',
        account_number_confirmation: '1',
        ifsc: 'HDFC',
        holder_name: 'V',
      })
      .expect(422);
    bank.get.mockResolvedValue({
      status: 'ACTION_REQUIRED',
      accountMasked: '••••5678',
      requiredActions: ['CORRECT_DETAILS'],
      nextScreen: 'BANK_DETAILS',
    });
    const view = await request(app.getHttpServer())
      .get(`${base}/bank-verifications/bv_1`)
      .expect(200);
    expect(view.body).toEqual({
      status: 'ACTION_REQUIRED',
      account_masked: '••••5678',
      required_actions: ['CORRECT_DETAILS'],
      next_screen: 'BANK_DETAILS',
    });
    expect(bank.get).toHaveBeenCalledWith('app_1', 'cus_1', 'bv_1');
  });

  it('PUT nomination maps nominees with guardians and rejects malformed input', async () => {
    nomination.save.mockResolvedValue({
      status: 'CAPTURED',
      registrationStatus: 'NOT_SUBMITTED',
      nominationVersion: 1,
      nextScreen: 'INVESTMENT_PROFILE',
    });
    const res = await request(app.getHttpServer())
      .put(`${base}/nomination`)
      .send({
        choice: 'NOMINATE',
        allocation_mode: 'CUSTOM',
        nominees: [
          {
            full_name: 'Asha Singh',
            relationship: 'SPOUSE',
            is_minor: false,
            allocation_percent: 60,
          },
          {
            full_name: 'Ravi Singh',
            relationship: 'SON',
            is_minor: true,
            date_of_birth: '2015-05-05',
            allocation_percent: 40,
            guardian: { full_name: 'Asha Singh', relationship: 'MOTHER' },
          },
        ],
      })
      .expect(200);
    expect(res.body).toEqual({
      status: 'CAPTURED',
      registration_status: 'NOT_SUBMITTED',
      nomination_version: 1,
      next_screen: 'INVESTMENT_PROFILE',
    });
    expect(nomination.save).toHaveBeenCalledWith({
      applicationId: 'app_1',
      customerId: 'cus_1',
      choice: 'NOMINATE',
      allocationMode: 'CUSTOM',
      nominees: [
        {
          fullName: 'Asha Singh',
          relationship: 'SPOUSE',
          isMinor: false,
          dateOfBirth: undefined,
          allocationPercent: 60,
          guardian: undefined,
        },
        {
          fullName: 'Ravi Singh',
          relationship: 'SON',
          isMinor: true,
          dateOfBirth: '2015-05-05',
          allocationPercent: 40,
          guardian: { fullName: 'Asha Singh', relationship: 'MOTHER' },
        },
      ],
    });
    await request(app.getHttpServer())
      .put(`${base}/nomination`)
      .send({ choice: 'MAYBE', nominees: [] })
      .expect(422);
    await request(app.getHttpServer())
      .put(`${base}/nomination`)
      .send({
        choice: 'NOMINATE',
        nominees: [{ full_name: 'A', relationship: 'SPOUSE', is_minor: 'no' }],
      })
      .expect(422);
    expect(nomination.save).toHaveBeenCalledTimes(1);
  });
});

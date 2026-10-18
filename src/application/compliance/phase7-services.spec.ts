import {
  FakeAnalytics,
  FakeApplications,
  FakeAudit,
  FakeCompliance,
  FakeCustomers,
  FakeDeclarations,
  FakeIdentities,
  FakeKycRecords,
  FakeOutbox,
  FakeProfiles,
  FakeStorage,
  FakeUow,
  FixedClock,
  SeqIds,
  silentLogger,
} from '../../../test/support/fakes';
import { CorrelationStore } from '../../common/correlation/correlation.store';
import {
  DependencyUnavailableError,
  NotFoundError,
  PartnerRejectedError,
  ValidationError,
} from '../../common/errors/app-error';
import {
  loadTrackWizzCodebook,
  type As501Response,
} from '../../domain/compliance/as501';
import { newApplication } from '../../domain/onboarding/application';
import { toIsoDate } from '../../domain/shared/iso-date';
import { toAs501Request } from '../../infrastructure/partners/trackwizz/trackwizz.mapper';
import {
  AmlAssessmentProcessor,
  parseTrackWizzDate,
} from '../jobs/aml-assessment.processor';
import { ScreeningProcessor } from '../jobs/screening.processor';
import type { As501Request } from '../ports/trackwizz-gateway.port';
import { ComplianceService } from './compliance.service';

const accepted = (
  requestId: string,
  customer: string,
  purposes: { code: string; data: Record<string, unknown> | null }[],
): As501Response => ({
  RequestId: requestId,
  ValidationCode: null,
  DecryptedData: {
    OverallStatus: 'AcceptedByTW',
    CustomerResponse: [
      {
        SourceSystemCustomerCode: customer,
        ValidationOutcome: 'Success',
        PurposeResponse: purposes.map((p) => ({
          PurposeCode: p.code,
          ValidationCode: '',
          ValidationFailureCount: 0,
          Data: p.data,
        })),
      },
    ],
  },
});

function build() {
  const clock = new FixedClock();
  const now = clock.now();
  const d = {
    uow: new FakeUow(),
    applications: new FakeApplications(),
    customers: new FakeCustomers((p) => p),
    identities: new FakeIdentities((p) => p),
    kyc: new FakeKycRecords(),
    profiles: new FakeProfiles(),
    declarations: new FakeDeclarations(),
    compliance: new FakeCompliance(),
    storage: new FakeStorage(),
    audit: new FakeAudit(),
    outbox: new FakeOutbox(),
    analytics: new FakeAnalytics(),
    clock,
    ids: new SeqIds(),
    gateway: {
      submit: jest.fn<
        Promise<{ response: As501Response; envelope: Record<string, unknown> }>,
        [As501Request]
      >(),
    },
  };
  void d.applications.create({
    ...newApplication('app_1', 'cus_1', now),
    status: 'SUBMITTED',
  });
  void d.customers.create({
    id: 'cus_1',
    phone: '+919000000001' as never,
    email: 'v@example.com' as never,
    state: 'VERIFIED',
    version: 1,
    createdAt: now,
  });
  void d.identities.append({
    applicationId: 'app_1',
    version: 1,
    pan: 'ABCPE1234F',
    legalName: 'Vinod Kumar Singh',
    dateOfBirth: toIsoDate('1990-01-15'),
    permissionVersion: 'v',
    status: 'SUBMITTED',
    submittedAt: now,
  });
  void d.kyc.create({
    id: 'kyc_1',
    applicationId: 'app_1',
    identityVersion: 1,
    provider: 'DIGIO_KRA',
    status: 'COMPLETE',
    route: 'REUSE',
    operationId: 'op',
    version: 2,
    summary: {
      correspondenceAddress: {
        line1: '1 Main St',
        city: 'Mumbai',
        stateCode: 'MH',
        pinCode: '400001',
      },
    },
    updatedAt: now,
  });
  void d.profiles.append({
    applicationId: 'app_1',
    version: 1,
    occupation: 'PRIVATE_SECTOR',
    annualIncomeBand: 'INR_10L_25L',
    sourceOfFunds: ['SALARY'],
    evidenceRequired: false,
    savedAt: now,
  });
  void d.declarations.append({
    applicationId: 'app_1',
    version: 1,
    taxResidencies: [
      { country: 'IN', tin: 'ABCPE1234F' },
      { country: 'US', tin: '123' },
    ],
    pepDeclaration: 'NOT_PEP',
    declarationVersion: 'declarations_v1',
    additionalInformationRequired: true,
    attestedAt: now,
  });
  const cfg = { trackwizz: { sourceSystemName: 'WMCPMS' } } as never;
  const service = new ComplianceService(
    d.uow,
    d.applications,
    d.customers,
    d.identities,
    d.kyc,
    d.profiles,
    d.declarations,
    d.compliance,
    d.audit,
    d.outbox,
    d.clock,
    d.ids,
    loadTrackWizzCodebook(),
    cfg,
  );
  const screening = new ScreeningProcessor(
    new CorrelationStore(),
    silentLogger as never,
    d.uow,
    d.applications,
    d.compliance,
    service,
    d.gateway,
    d.storage,
    d.audit,
    d.outbox,
    d.analytics,
    d.clock,
    d.ids,
  );
  const aml = new AmlAssessmentProcessor(
    new CorrelationStore(),
    silentLogger as never,
    d.uow,
    d.applications,
    d.compliance,
    service,
    d.gateway,
    d.storage,
    d.audit,
    d.outbox,
    d.analytics,
    d.clock,
    d.ids,
  );
  return { d, service, screening, aml };
}
const job = (attemptsMade = 0, attempts = 5) =>
  ({ attemptsMade, opts: { attempts } }) as never;

describe('AS501 request mapping', () => {
  it('builds the customer record from verified facts with codebooks and never guesses unknown codes', async () => {
    const { service } = build();
    const subject = (await service.subject('app_1'))!;
    const req = toAs501Request(
      'sr_1',
      '01,04',
      subject,
      loadTrackWizzCodebook(),
      'WMCPMS',
      new Date('2026-10-18T05:00:00Z'),
    );
    expect(req).toMatchObject({
      requestId: 'sr_1',
      sourceSystemName: 'WMCPMS',
      purpose: '01,04',
    });
    expect(req.customerList[0]).toMatchObject({
      constitutionType: '1',
      sourceSystemCustomerCode: 'cus_1',
      applicationRefNumber: 'app_1',
      uniqueIdentifier: 'ABCPE1234F',
      firstName: 'Vinod',
      middleName: 'Kumar',
      lastName: 'Singh',
      dateofBirth: '15-Jan-1990',
      pan: 'ABCPE1234F',
      personalEmail: 'v@example.com',
      personalMobileISD: '91',
      personalMobileNumber: '9000000001',
      occupationType: 'SA',
      incomeRange: '4',
      politicallyExposed: 'NotAPEP',
      countryOfResidence: 'IND',
      correspondenceAddressLine1: '1 Main St',
      correspondenceAddressZipCode: '400001',
      taxDetailDtoList: [{ country: 'IND' }, { country: 'USA' }],
      effectiveDate: '18-Oct-2026',
      riskProfile: '',
    });
    const risk = toAs501Request(
      'aml_1',
      '06',
      {
        ...subject,
        occupation: 'UNKNOWN',
        pepDeclaration: undefined,
        address: undefined,
        phone: undefined,
        email: undefined,
        taxResidencyCountries: ['ZZ'],
      },
      loadTrackWizzCodebook(),
      'WMCPMS',
      new Date(),
    );
    expect(risk.customerList[0]).toMatchObject({
      occupationType: '',
      politicallyExposed: '',
      personalMobileISD: '',
      correspondenceAddressLine1: '',
      taxDetailDtoList: [],
      riskProfile: 'DEFAULT',
    });
    expect(parseTrackWizzDate('21-Mar-2027')).toEqual(
      new Date(Date.UTC(2027, 2, 21)),
    );
    expect(parseTrackWizzDate('2027-03-21')).toBeUndefined();
    expect(parseTrackWizzDate('21-Xyz-2027')).toBeUndefined();
  });
});

describe('ComplianceService re-runs', () => {
  it('queues screening and AML for the current versions only, superseding the same kind', async () => {
    const { d, service } = build();
    await d.compliance.createScreeningRun({
      id: 'sr_old',
      applicationId: 'app_1',
      identityVersion: 1,
      screeningPolicyVersion: 'screening_v1',
      status: 'QUEUED',
      createdAt: new Date(),
    });
    await d.compliance.createAmlAssessment({
      id: 'aml_old',
      applicationId: 'app_1',
      identityVersion: 1,
      profileVersion: 1,
      declarationVersion: 1,
      policyVersion: 'aml_v1',
      status: 'QUEUED',
      createdAt: new Date(),
    });
    const r = await service.requestScreening({
      applicationId: 'app_1',
      identityVersion: 1,
      screeningPolicyVersion: 'screening_v1',
      requestedBy: 'ops',
    });
    expect(r.status).toBe('QUEUED');
    expect(d.compliance.runs.map((x) => x.status)).toEqual([
      'SUPERSEDED',
      'QUEUED',
    ]);
    expect(d.compliance.assessments[0].status).toBe('QUEUED');
    expect(d.outbox.events.at(-1)).toMatchObject({
      eventType: 'ScreeningRequested',
      payload: { screeningRunId: r.screeningRunId },
    });
    await expect(
      service.requestScreening({
        applicationId: 'app_1',
        identityVersion: 2,
        screeningPolicyVersion: 'v',
        requestedBy: 'ops',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      service.requestScreening({
        applicationId: 'app_x',
        identityVersion: 1,
        screeningPolicyVersion: 'v',
        requestedBy: 'ops',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const a = await service.requestAml({
      applicationId: 'app_1',
      identityVersion: 1,
      profileVersion: 1,
      declarationVersion: 1,
      policyVersion: 'aml_v1',
      requestedBy: 'ops',
    });
    expect(d.compliance.assessments.map((x) => x.status)).toEqual([
      'SUPERSEDED',
      'QUEUED',
    ]);
    expect(d.outbox.events.at(-1)).toMatchObject({
      eventType: 'AmlAssessmentRequested',
      payload: { assessmentId: a.assessmentId },
    });
    await expect(
      service.requestAml({
        applicationId: 'app_1',
        identityVersion: 1,
        profileVersion: 2,
        declarationVersion: 1,
        policyVersion: 'v',
        requestedBy: 'ops',
      }),
    ).rejects.toMatchObject({ details: { field: 'profile_version' } });
    await expect(
      service.requestAml({
        applicationId: 'app_1',
        identityVersion: 1,
        profileVersion: 1,
        declarationVersion: 3,
        policyVersion: 'v',
        requestedBy: 'ops',
      }),
    ).rejects.toMatchObject({ details: { field: 'declaration_version' } });
    expect(await service.subject('app_nope')).toBeNull();
  });
});

describe('ScreeningProcessor', () => {
  async function queued(b: ReturnType<typeof build>) {
    return (
      await b.service.requestScreening({
        applicationId: 'app_1',
        identityVersion: 1,
        screeningPolicyVersion: 'screening_v1',
        requestedBy: 'ops',
      })
    ).screeningRunId;
  }
  it('clears a clean Proceed, stores evidence, re-triggers activation, and is idempotent on redelivery', async () => {
    const b = build();
    const id = await queued(b);
    b.d.gateway.submit.mockImplementation((req) =>
      Promise.resolve({
        response: accepted(req.requestId, 'cus_1', [
          {
            code: '01',
            data: {
              SuggestedAction: 'Proceed',
              HitsDetected: 'No',
              HitsCount: 0,
              ConfirmedHits: 'No',
            },
          },
          { code: '04', data: null },
        ]),
        envelope: { EncryptedData: 'x', EncryptionKey: 'y', Signature: 'z' },
      }),
    );
    await b.screening.handle({ payload: { screeningRunId: id } }, job());
    await b.screening.handle({ payload: { screeningRunId: id } }, job());
    expect(b.d.gateway.submit).toHaveBeenCalledTimes(1);
    expect(b.d.gateway.submit.mock.calls[0][0]).toMatchObject({
      requestId: id,
      purpose: '01,04',
    });
    expect(await b.d.compliance.findScreeningRun(id)).toMatchObject({
      status: 'PROCEED',
      suggestedAction: 'Proceed',
      hitsCount: 0,
      confirmedHit: false,
      evidenceKey: `compliance/app_1/screening/${id}.json`,
    });
    expect(b.d.compliance.cases).toHaveLength(0);
    expect(b.d.outbox.events.at(-1)).toMatchObject({
      eventType: 'ComplianceOutcomeRecorded',
      payload: {
        applicationId: 'app_1',
        kind: 'SCREENING',
        outcome: 'PROCEED',
      },
    });
    expect(b.d.analytics.events.at(-1)).toMatchObject({
      name: 'Application Processing Updated',
      outcome: 'screening_clear',
    });
    expect(JSON.stringify(b.d.analytics.events)).not.toMatch(
      /Proceed|ABCPE|Vinod/,
    );
    expect(
      JSON.parse(
        b.d.storage.objects
          .get(`compliance/app_1/screening/${id}.json`)!
          .body.toString(),
      ),
    ).toMatchObject({ envelope: { Signature: 'z' } });
  });
  it('Review and Stop open restricted cases with the provider case reference', async () => {
    const b = build();
    const id = await queued(b);
    b.d.gateway.submit.mockImplementation((req) =>
      Promise.resolve({
        response: accepted(req.requestId, 'cus_1', [
          {
            code: '01',
            data: {
              SuggestedAction: 'Stop',
              HitsCount: 2,
              ConfirmedHits: 'Yes',
              CaseId: 'C9',
              CaseURL: 'https://tw/C9',
              HitResponse: [{ MatchType: 'KeyActivity' }],
            },
          },
          { code: '04', data: null },
        ]),
        envelope: {},
      }),
    );
    await b.screening.handle({ payload: { screeningRunId: id } }, job());
    expect((await b.d.compliance.findScreeningRun(id))!.status).toBe('STOP');
    expect(b.d.compliance.cases[0]).toMatchObject({
      kind: 'SCREENING_HIT',
      severity: 'HIGH',
      status: 'OPEN',
      providerCaseId: 'C9',
      providerCaseUrl: 'https://tw/C9',
      summary: {
        hitsCount: 2,
        confirmedHit: true,
        matchTypes: ['KeyActivity'],
      },
    });
    expect(b.d.analytics.events.at(-1)).toMatchObject({
      outcome: 'screening_review',
    });
    expect(JSON.stringify(b.d.analytics.events)).not.toContain('C9');
  });
  it('never clears on errors: mismatched request id, bad envelope, vendor rejection; outages retry then fail', async () => {
    const b = build();
    const id = await queued(b);
    b.d.gateway.submit.mockResolvedValueOnce({
      response: accepted('other', 'cus_1', [
        { code: '01', data: { SuggestedAction: 'Proceed' } },
        { code: '04', data: null },
      ]),
      envelope: {},
    });
    await b.screening.handle({ payload: { screeningRunId: id } }, job());
    expect(await b.d.compliance.findScreeningRun(id)).toMatchObject({
      status: 'ERROR',
      safeErrorCategory: 'request_id_mismatch',
    });
    const id2 = await queued(b);
    b.d.gateway.submit.mockRejectedValueOnce(
      new PartnerRejectedError('trackwizz', 'signature_invalid', undefined, {
        details: { category: 'signature_invalid' },
      }),
    );
    await b.screening.handle({ payload: { screeningRunId: id2 } }, job());
    expect(await b.d.compliance.findScreeningRun(id2)).toMatchObject({
      status: 'ERROR',
      safeErrorCategory: 'envelope_invalid',
    });
    const id3 = await queued(b);
    b.d.gateway.submit.mockRejectedValueOnce(
      new PartnerRejectedError('trackwizz', 'MRV14'),
    );
    await b.screening.handle({ payload: { screeningRunId: id3 } }, job());
    expect(await b.d.compliance.findScreeningRun(id3)).toMatchObject({
      status: 'ERROR',
      safeErrorCategory: 'provider_rejected',
    });
    const id4 = await queued(b);
    b.d.gateway.submit.mockRejectedValue(new DependencyUnavailableError());
    await expect(
      b.screening.handle({ payload: { screeningRunId: id4 } }, job(0, 3)),
    ).rejects.toBeInstanceOf(DependencyUnavailableError);
    expect((await b.d.compliance.findScreeningRun(id4))!.status).toBe('QUEUED');
    await b.screening.handle({ payload: { screeningRunId: id4 } }, job(2, 3));
    expect(await b.d.compliance.findScreeningRun(id4)).toMatchObject({
      status: 'ERROR',
      safeErrorCategory: 'provider_unavailable',
    });
    b.d.gateway.submit.mockRejectedValueOnce(new Error('boom'));
    const id5 = await queued(b);
    await expect(
      b.screening.handle({ payload: { screeningRunId: id5 } }, job()),
    ).rejects.toThrow('boom');
    await b.screening.handle({}, job());
    await b.screening.handle({ payload: { screeningRunId: 'sr_nope' } }, job());
    b.d.identities.rows.length = 0;
    const id6 = await queued(b).catch(() => null);
    expect(id6).toBeNull();
  });
});

describe('AmlAssessmentProcessor', () => {
  async function queued(b: ReturnType<typeof build>) {
    return (
      await b.service.requestAml({
        applicationId: 'app_1',
        identityVersion: 1,
        profileVersion: 1,
        declarationVersion: 1,
        policyVersion: 'aml_v1',
        requestedBy: 'ops',
      })
    ).assessmentId;
  }
  it('Low proceeds with the review date; High opens an EDD case, never a rejection', async () => {
    const b = build();
    const id = await queued(b);
    b.d.gateway.submit.mockImplementation((req) =>
      Promise.resolve({
        response: accepted(req.requestId, 'cus_1', [
          {
            code: '06',
            data: {
              RiskValue: 'Low',
              NextRiskReviewDate: '21-Mar-2027',
              ReportData: 'QQ==',
            },
          },
        ]),
        envelope: {},
      }),
    );
    await b.aml.handle({ payload: { assessmentId: id } }, job());
    expect(b.d.gateway.submit.mock.calls[0][0]).toMatchObject({
      purpose: '06',
      requestId: id,
    });
    expect(await b.d.compliance.findAmlAssessment(id)).toMatchObject({
      status: 'PROCEED',
      riskValue: 'Low',
      nextReviewDate: new Date(Date.UTC(2027, 2, 21)),
    });
    expect(b.d.outbox.events.at(-1)).toMatchObject({
      eventType: 'ComplianceOutcomeRecorded',
      payload: { kind: 'AML', outcome: 'PROCEED' },
    });
    const id2 = await queued(b);
    b.d.gateway.submit.mockImplementation((req) =>
      Promise.resolve({
        response: accepted(req.requestId, 'cus_1', [
          { code: '06', data: { RiskValue: 'High', NextRiskReviewDate: '' } },
        ]),
        envelope: {},
      }),
    );
    await b.aml.handle({ payload: { assessmentId: id2 } }, job());
    expect(await b.d.compliance.findAmlAssessment(id2)).toMatchObject({
      status: 'REVIEW',
      riskValue: 'High',
      nextReviewDate: undefined,
    });
    expect(b.d.compliance.cases.at(-1)).toMatchObject({
      kind: 'AML_HIGH_RISK',
      severity: 'HIGH',
      summary: { riskValue: 'High', process: 'ENHANCED_DUE_DILIGENCE' },
    });
    expect(b.d.applications.rows.get('app_1')!.status).toBe('SUBMITTED');
    expect(JSON.stringify(b.d.analytics.events)).not.toMatch(/High|Low/);
    await b.aml.handle({ payload: { assessmentId: id2 } }, job()); // terminal → no second call
    expect(b.d.gateway.submit).toHaveBeenCalledTimes(2);
  });
  it('errors are recorded without clearing; outages retry; unexpected errors propagate', async () => {
    const b = build();
    const id = await queued(b);
    b.d.gateway.submit.mockRejectedValueOnce(
      new PartnerRejectedError('trackwizz', 'decrypt_failed', undefined, {
        details: { category: 'decrypt_failed' },
      }),
    );
    await b.aml.handle({ payload: { assessmentId: id } }, job());
    expect(await b.d.compliance.findAmlAssessment(id)).toMatchObject({
      status: 'ERROR',
      safeErrorCategory: 'envelope_invalid',
    });
    const id2 = await queued(b);
    b.d.gateway.submit.mockRejectedValue(new DependencyUnavailableError());
    await expect(
      b.aml.handle({ payload: { assessmentId: id2 } }, job(0, 2)),
    ).rejects.toBeInstanceOf(DependencyUnavailableError);
    await b.aml.handle({ payload: { assessmentId: id2 } }, job(1, 2));
    expect(
      (await b.d.compliance.findAmlAssessment(id2))!.safeErrorCategory,
    ).toBe('provider_unavailable');
    const id3 = await queued(b);
    b.d.gateway.submit.mockRejectedValueOnce(
      new PartnerRejectedError('trackwizz', 'MRV2'),
    );
    await b.aml.handle({ payload: { assessmentId: id3 } }, job());
    expect(
      (await b.d.compliance.findAmlAssessment(id3))!.safeErrorCategory,
    ).toBe('provider_rejected');
    const id4 = await queued(b);
    b.d.gateway.submit.mockRejectedValueOnce(new Error('boom'));
    await expect(
      b.aml.handle({ payload: { assessmentId: id4 } }, job()),
    ).rejects.toThrow('boom');
    await b.aml.handle({}, job());
    b.d.customers.rows.clear();
    const id5 = await queued(b);
    await b.aml.handle({ payload: { assessmentId: id5 } }, job());
    expect(
      (await b.d.compliance.findAmlAssessment(id5))!.safeErrorCategory,
    ).toBe('subject_unavailable');
  });
});

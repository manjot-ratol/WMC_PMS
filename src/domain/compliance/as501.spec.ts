import {
  evaluateRiskRating,
  evaluateScreening,
  loadTrackWizzCodebook,
  splitName,
  toTrackWizzDate,
  validateAs501,
  type As501Response,
} from './as501';

const expected = {
  requestId: 'sr_1',
  customerCode: 'cus_1',
  purposeCodes: ['01', '04'],
};
const formal = (
  data: Record<string, unknown> | null,
  extraCustomer: Record<string, unknown> = {},
  over: Partial<As501Response> = {},
): As501Response => ({
  RequestId: 'sr_1',
  ValidationCode: null,
  ValidationDescription: null,
  DecryptedData: {
    OverallStatus: 'AcceptedByTW',
    CustomerResponse: [
      {
        SourceSystemCustomerCode: 'cus_1',
        ValidationOutcome: 'Success',
        ...extraCustomer,
        PurposeResponse: [
          {
            PurposeCode: '01',
            ValidationCode: '',
            ValidationFailureCount: 0,
            Data: data,
          },
          {
            PurposeCode: '04',
            ValidationCode: '',
            ValidationFailureCount: 0,
            Data: null,
          },
        ],
      },
    ],
  },
  ...over,
});

describe('evaluateScreening', () => {
  it('clears only a fully validated Proceed with no hits; Review and Stop map to holds', () => {
    expect(
      evaluateScreening(
        formal({
          SuggestedAction: 'Proceed',
          HitsDetected: 'No',
          HitsCount: 0,
          ConfirmedHits: 'No',
        }),
        expected,
      ),
    ).toMatchObject({
      outcome: 'PROCEED',
      hitsCount: 0,
      confirmedHit: false,
      matchTypes: [],
    });
    expect(
      evaluateScreening(
        formal({
          SuggestedAction: 'Review',
          HitsCount: 2,
          ConfirmedHit: 'No',
          CaseId: 'C1',
          CaseURL: 'https://tw/case/C1',
          HitResponse: [{ MatchType: 'Probable' }, { MatchType: 'Probable' }],
        }),
        expected,
      ),
    ).toMatchObject({
      outcome: 'REVIEW',
      hitsCount: 2,
      confirmedHit: false,
      providerCaseId: 'C1',
      matchTypes: ['Probable'],
    });
    expect(
      evaluateScreening(
        formal({
          SuggestedAction: 'Stop',
          HitsCount: 2,
          ConfirmedHits: 'Yes',
          HitResponse: [
            { MatchType: 'KeyActivity' },
            { MatchType: 'Probable' },
          ],
        }),
        expected,
      ),
    ).toMatchObject({
      outcome: 'STOP',
      confirmedHit: true,
      matchTypes: ['KeyActivity', 'Probable'],
    });
  });
  it('accepts the root example wrapper with customer-level SuggestedAction', () => {
    const root: As501Response = {
      RequestId: 'sr_1',
      OverallStatus: 'AcceptedbyTW',
      CustomerResponse: [
        {
          SourceSystemCustomerCode: 'cus_1',
          ValidationOutcome: 'Success',
          SuggestedAction: 'Proceed',
          PurposeResponse: [
            {
              PurposeCode: '01',
              ValidationFailureCount: 0,
              Data: { HitsDetected: 'No', HitsCount: 0 },
            },
            { PurposeCode: '04', Data: null },
          ],
        },
      ],
    };
    expect(evaluateScreening(root, expected).outcome).toBe('PROCEED');
  });
  it('never defaults to Proceed: mismatched ids, rejected requests, conflicting or missing actions, hits with Proceed', () => {
    const ok = { SuggestedAction: 'Proceed', HitsCount: 0 };
    expect(
      evaluateScreening(formal(ok, {}, { RequestId: 'other' }), expected),
    ).toMatchObject({ outcome: 'ERROR', category: 'request_id_mismatch' });
    expect(
      evaluateScreening(
        formal(ok, { SourceSystemCustomerCode: 'cus_2' }),
        expected,
      ),
    ).toMatchObject({ outcome: 'ERROR', category: 'customer_mismatch' });
    expect(
      evaluateScreening(formal(ok, {}, { ValidationCode: 'MRV2' }), expected),
    ).toMatchObject({ outcome: 'ERROR', category: 'request_rejected' });
    expect(
      evaluateScreening(
        {
          ...formal(ok),
          DecryptedData: {
            OverallStatus: 'RejectedByTW',
            CustomerResponse: [],
          },
        },
        expected,
      ),
    ).toMatchObject({ category: 'rejected_by_tw' });
    expect(
      evaluateScreening(formal(ok, { ValidationOutcome: 'Failure' }), expected),
    ).toMatchObject({ category: 'customer_validation_failed' });
    expect(
      evaluateScreening(
        formal({ SuggestedAction: 'Proceed' }, { SuggestedAction: 'Review' }),
        expected,
      ),
    ).toMatchObject({
      outcome: 'ERROR',
      category: 'suggested_action_conflict',
    });
    expect(evaluateScreening(formal({ HitsCount: 0 }), expected)).toMatchObject(
      { outcome: 'ERROR', category: 'suggested_action_missing' },
    );
    expect(
      evaluateScreening(formal({ SuggestedAction: 'Maybe' }), expected),
    ).toMatchObject({ outcome: 'ERROR', category: 'unknown_suggested_action' });
    expect(
      evaluateScreening(
        formal({ SuggestedAction: 'Proceed', HitsCount: 1 }),
        expected,
      ),
    ).toMatchObject({ outcome: 'REVIEW', category: 'proceed_with_hits' });
    expect(evaluateScreening({ RequestId: 'sr_1' }, expected)).toMatchObject({
      category: 'unexpected_response_shape',
    });
    expect(evaluateScreening({}, expected)).toMatchObject({
      category: 'unexpected_response_shape',
    });
  });
  it('purpose coverage: a missing purpose 01, a validation failure, or purpose 04 alone is an error', () => {
    const onlyFour: As501Response = formal(null);
    onlyFour.DecryptedData!.CustomerResponse![0].PurposeResponse = [
      { PurposeCode: '04', ValidationFailureCount: 0, Data: null },
    ];
    expect(evaluateScreening(onlyFour, expected)).toMatchObject({
      outcome: 'ERROR',
      category: 'purpose_01_missing',
    });
    const failed = formal({ SuggestedAction: 'Proceed' });
    failed.DecryptedData!.CustomerResponse![0].PurposeResponse![1].ValidationFailureCount = 1;
    expect(evaluateScreening(failed, expected)).toMatchObject({
      category: 'purpose_04_validation_failed',
    });
    const coded = formal({ SuggestedAction: 'Proceed' });
    coded.DecryptedData!.CustomerResponse![0].PurposeResponse![0].ValidationCode =
      'MRV14';
    expect(evaluateScreening(coded, expected)).toMatchObject({
      category: 'purpose_01_validation_failed',
    });
    expect(
      validateAs501(formal({ SuggestedAction: 'Proceed' }), {
        ...expected,
        purposeCodes: ['03'],
      }),
    ).toMatchObject({ category: 'purpose_03_missing' });
  });
});

describe('evaluateRiskRating', () => {
  const six = {
    requestId: 'aml_1',
    customerCode: 'cus_1',
    purposeCodes: ['06'],
  };
  const risk = (data: Record<string, unknown> | null): As501Response => ({
    RequestId: 'aml_1',
    DecryptedData: {
      OverallStatus: 'AcceptedByTW',
      CustomerResponse: [
        {
          SourceSystemCustomerCode: 'cus_1',
          ValidationOutcome: 'Success',
          PurposeResponse: [
            { PurposeCode: '06', ValidationFailureCount: 0, Data: data },
          ],
        },
      ],
    },
  });
  it('High is EDD review, Medium/Low proceed, anything else is an error', () => {
    expect(
      evaluateRiskRating(
        risk({
          RiskValue: 'High',
          NextRiskReviewDate: '21-Mar-2027',
          ReportData: 'QUJD',
        }),
        six,
      ),
    ).toEqual({
      outcome: 'REVIEW',
      riskValue: 'High',
      nextReviewDate: '21-Mar-2027',
      reportAvailable: true,
    });
    expect(
      evaluateRiskRating(
        risk({ RiskValue: 'low', NextRiskReviewDate: '' }),
        six,
      ),
    ).toMatchObject({
      outcome: 'PROCEED',
      riskValue: 'Low',
      nextReviewDate: undefined,
      reportAvailable: false,
    });
    expect(
      evaluateRiskRating(risk({ RiskValue: 'Medium' }), six, [
        'High',
        'Medium',
      ]),
    ).toMatchObject({ outcome: 'REVIEW', riskValue: 'Medium' });
    expect(
      evaluateRiskRating(risk({ RiskValue: 'Extreme' }), six),
    ).toMatchObject({ outcome: 'ERROR', category: 'unknown_risk_value' });
    expect(evaluateRiskRating(risk(null), six)).toMatchObject({
      outcome: 'ERROR',
      category: 'risk_value_missing',
    });
    expect(
      evaluateRiskRating(risk({ RiskValue: 'Low' }), {
        ...six,
        requestId: 'x',
      }),
    ).toMatchObject({ outcome: 'ERROR', category: 'request_id_mismatch' });
  });
});

describe('helpers and codebook', () => {
  it('formats dates and splits names the TrackWizz way; codebook loads', () => {
    expect(toTrackWizzDate('1990-01-15')).toBe('15-Jan-1990');
    expect(splitName('Vinod')).toEqual({
      firstName: 'Vinod',
      middleName: '',
      lastName: '',
    });
    expect(splitName('Vinod Singh')).toEqual({
      firstName: 'Vinod',
      middleName: '',
      lastName: 'Singh',
    });
    expect(splitName('Vinod Kumar Pratap Singh')).toEqual({
      firstName: 'Vinod',
      middleName: 'Kumar Pratap',
      lastName: 'Singh',
    });
    const cb = loadTrackWizzCodebook();
    expect(cb.screeningPurposes).toBe('01,04');
    expect(cb.countries.IN).toBe('IND');
  });
});

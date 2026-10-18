import {
  StaleVersionError,
  ValidationError,
} from '../../common/errors/app-error';
import {
  loadDocumentPackRulebook,
  validateAcknowledgements,
} from '../documents/document-pack';
import { illustrateFees, loadFeeRulebook } from '../fees/fee-engine';
import {
  canonicalJson,
  hashSections,
  maskPan,
  type ReviewSections,
} from '../review/review-snapshot';
import {
  assertApproachPermitted,
  assessSuitability,
  loadSuitabilityRulebook,
} from './suitability';

const rb = loadSuitabilityRulebook();
const full = (overrides: Record<string, string> = {}) =>
  Object.entries({
    OBJECTIVE: 'LONG_TERM_GROWTH',
    HORIZON: 'FIVE_YEARS_PLUS',
    LIQUIDITY: 'NONE_EXPECTED',
    EXPERIENCE: 'DIRECT_EQUITY',
    RISK_CAPACITY: 'LOSS_UP_TO_25',
    ...overrides,
  }).map(([questionId, answerId]) => ({ questionId, answerId }));

describe('assessSuitability', () => {
  it('scores a complete questionnaire into a band with permitted approaches', () => {
    const r = assessSuitability(full(), rb);
    expect(r).toEqual({
      status: 'COMPLETE',
      missingQuestionIds: [],
      score: 18,
      riskProfile: 'AGGRESSIVE',
      permittedApproachCodes: [
        'BALANCED_MULTI_ASSET',
        'EQUITY_GROWTH',
        'FOCUSED_EQUITY',
      ],
    });
    expect(
      assessSuitability(
        full({
          OBJECTIVE: 'CAPITAL_PRESERVATION',
          HORIZON: 'ONE_TO_THREE_YEARS',
          LIQUIDITY: 'WITHIN_3_YEARS',
          EXPERIENCE: 'NONE',
          RISK_CAPACITY: 'LOSS_UP_TO_10',
        }),
        rb,
      ),
    ).toMatchObject({ riskProfile: 'CONSERVATIVE', score: 8 });
  });
  it('partial answers are INCOMPLETE with the missing ids in questionnaire order and no approaches', () => {
    expect(assessSuitability(full().slice(0, 2), rb)).toEqual({
      status: 'INCOMPLETE',
      missingQuestionIds: ['LIQUIDITY', 'EXPERIENCE', 'RISK_CAPACITY'],
      permittedApproachCodes: [],
    });
    expect(assessSuitability([], rb).missingQuestionIds).toHaveLength(5);
  });
  it('rejects unknown ids, duplicates and contradictory answers (with both question ids)', () => {
    expect(() =>
      assessSuitability([{ questionId: 'AGE', answerId: 'X' }], rb),
    ).toThrow(ValidationError);
    expect(() =>
      assessSuitability([{ questionId: 'OBJECTIVE', answerId: 'MOON' }], rb),
    ).toThrow(ValidationError);
    expect(() =>
      assessSuitability(
        [...full(), { questionId: 'OBJECTIVE', answerId: 'REGULAR_INCOME' }],
        rb,
      ),
    ).toThrow(ValidationError);
    try {
      assessSuitability(full({ HORIZON: 'UNDER_1_YEAR' }), rb);
      throw new Error('expected rejection');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).details).toEqual({
        reason: 'contradictory_answers',
        questionIds: ['OBJECTIVE', 'HORIZON'],
      });
    }
    // a contradiction is detected even on a partial set
    expect(() =>
      assessSuitability(
        [
          { questionId: 'OBJECTIVE', answerId: 'LONG_TERM_GROWTH' },
          { questionId: 'HORIZON', answerId: 'UNDER_1_YEAR' },
        ],
        rb,
      ),
    ).toThrow(/contradict/);
  });
  it('approach permission follows the band; incomplete never permits; unknown codes are rejected', () => {
    const r = assessSuitability(full(), rb);
    expect(() => assertApproachPermitted(r, 'EQUITY_GROWTH', rb)).not.toThrow();
    expect(() => assertApproachPermitted(r, 'CONSERVATIVE_INCOME', rb)).toThrow(
      /not available/,
    );
    expect(() => assertApproachPermitted(r, 'NOPE', rb)).toThrow(
      ValidationError,
    );
    expect(() =>
      assertApproachPermitted(
        { status: 'INCOMPLETE', permittedApproachCodes: [] },
        'EQUITY_GROWTH',
        rb,
      ),
    ).toThrow(ValidationError);
  });
  it('a score outside every band is a configuration error, not a customer error', () => {
    expect(() => assessSuitability(full(), { ...rb, bands: [] })).toThrow(
      /no band/,
    );
  });
});

describe('illustrateFees', () => {
  const fees = loadFeeRulebook();
  it('charges performance fee only on return above hurdle after fixed costs; integer rupees', () => {
    const r = illustrateFees('EQUITY_GROWTH', 'RETURN_PLUS_20', fees);
    const by = Object.fromEntries(
      r.lineItems.map((l) => [l.code, l.amountInr]),
    );
    expect(by).toEqual({
      GROSS_RETURN: 1_000_000,
      MANAGEMENT_FEE: 100_000,
      OPERATING_EXPENSES: 17_500,
      PERFORMANCE_FEE: 57_375,
      TOTAL_FEES: 174_875,
      NET_RETURN: 825_125,
    });
    expect(r).toMatchObject({
      feeScheduleVersion: 'fees_v1',
      disclaimerVersion: 'illustration_v1',
      assumptions: {
        investmentInr: 5_000_000,
        assumedReturnBps: 2000,
        periodYears: 1,
      },
    });
  });
  it('no performance fee on flat or negative returns; conservative approach has none at all', () => {
    const loss = Object.fromEntries(
      illustrateFees('EQUITY_GROWTH', 'RETURN_NEGATIVE_10', fees).lineItems.map(
        (l) => [l.code, l.amountInr],
      ),
    );
    expect(loss.PERFORMANCE_FEE).toBe(0);
    expect(loss.NET_RETURN).toBe(-500_000 - 100_000 - 17_500);
    expect(
      Object.fromEntries(
        illustrateFees(
          'CONSERVATIVE_INCOME',
          'RETURN_PLUS_20',
          fees,
        ).lineItems.map((l) => [l.code, l.amountInr]),
      ).PERFORMANCE_FEE,
    ).toBe(0);
  });
  it('rejects approaches without terms and unknown scenarios', () => {
    expect(() => illustrateFees('NOPE', 'RETURN_FLAT', fees)).toThrow(
      ValidationError,
    );
    expect(() => illustrateFees('EQUITY_GROWTH', 'MOON', fees)).toThrow(
      ValidationError,
    );
  });
});

describe('validateAcknowledgements', () => {
  const pack = loadDocumentPackRulebook();
  const ok = {
    documentPackVersion: 1,
    acknowledgements: [
      {
        documentType: 'DISCLOSURE',
        documentVersion: 'disclosure_v1',
        acknowledged: true,
      },
      { documentType: 'MITC', documentVersion: 'mitc_v1', acknowledged: true },
    ],
    feeUnderstandingNote:
      '  I understand   the management and performance fees apply annually. ',
  };
  it('accepts explicit acknowledgements at current versions and normalises the note', () => {
    const r = validateAcknowledgements(ok, pack);
    expect(r.feeAnnexureExecutionRequired).toBe(true);
    expect(r.items).toEqual([
      { documentType: 'DISCLOSURE', documentVersion: 'disclosure_v1' },
      { documentType: 'MITC', documentVersion: 'mitc_v1' },
    ]);
    expect(r.note).toBe(
      'I understand the management and performance fees apply annually.',
    );
  });
  it('an old pack or document version is stale; viewing is not acknowledging; the note is required', () => {
    expect(() =>
      validateAcknowledgements({ ...ok, documentPackVersion: 0 }, pack),
    ).toThrow(StaleVersionError);
    expect(() =>
      validateAcknowledgements(ok, { ...pack, packVersion: 2 }),
    ).toThrow(StaleVersionError);
    expect(() =>
      validateAcknowledgements(
        {
          ...ok,
          acknowledgements: [
            { ...ok.acknowledgements[0], documentVersion: 'disclosure_v0' },
            ok.acknowledgements[1],
          ],
        },
        pack,
      ),
    ).toThrow(StaleVersionError);
    expect(() =>
      validateAcknowledgements(
        {
          ...ok,
          acknowledgements: [
            { ...ok.acknowledgements[0], acknowledged: false },
            ok.acknowledgements[1],
          ],
        },
        pack,
      ),
    ).toThrow(ValidationError);
    expect(() =>
      validateAcknowledgements(
        { ...ok, acknowledgements: [ok.acknowledgements[0]] },
        pack,
      ),
    ).toThrow(/.*/);
    expect(() =>
      validateAcknowledgements(
        {
          ...ok,
          acknowledgements: [...ok.acknowledgements, ok.acknowledgements[0]],
        },
        pack,
      ),
    ).toThrow(ValidationError);
    expect(() =>
      validateAcknowledgements(
        {
          ...ok,
          acknowledgements: [
            ...ok.acknowledgements,
            {
              documentType: 'SECRET',
              documentVersion: 'x',
              acknowledged: true,
            },
          ],
        },
        pack,
      ),
    ).toThrow(ValidationError);
    expect(() =>
      validateAcknowledgements({ ...ok, feeUnderstandingNote: 'ok' }, pack),
    ).toThrow(/own words/);
    expect(() =>
      validateAcknowledgements(
        { ...ok, feeUnderstandingNote: 'x'.repeat(501) },
        pack,
      ),
    ).toThrow(ValidationError);
  });
});

describe('review snapshot helpers', () => {
  it('masks PAN and hashes canonically regardless of key order', () => {
    expect(maskPan('ABCPE1234F')).toBe('AB••••••4F');
    expect(canonicalJson({ b: 1, a: [{ z: undefined, y: 'x' }] })).toBe(
      '{"a":[{"y":"x"}],"b":1}',
    );
    const s = {
      identity: {
        version: 1,
        legalName: 'V',
        panMasked: 'AB••••••4F',
        dateOfBirth: '1990-01-01',
      },
    } as unknown as ReviewSections;
    const t = {
      identity: {
        dateOfBirth: '1990-01-01',
        panMasked: 'AB••••••4F',
        legalName: 'V',
        version: 1,
      },
    } as unknown as ReviewSections;
    expect(hashSections(s)).toBe(hashSections(t));
    expect(hashSections(s)).toMatch(/^[0-9a-f]{64}$/);
  });
});

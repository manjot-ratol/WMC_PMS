import { ValidationError } from '../../common/errors/app-error';
import { loadTaxRulebook, validateDeclarations } from './declarations';
import { loadProfileRulebook, validateProfile } from './profile';

describe('validateProfile', () => {
  const rb = loadProfileRulebook();
  const ok = {
    occupation: 'PRIVATE_SECTOR',
    annualIncomeBand: 'INR_10L_25L',
    sourceOfFunds: ['SALARY'],
  };
  it('accepts valid vocabulary and flags evidence per policy', () => {
    expect(validateProfile(ok, rb)).toEqual({ evidenceRequired: false });
    expect(
      validateProfile({ ...ok, annualIncomeBand: 'INR_ABOVE_1CR' }, rb),
    ).toEqual({ evidenceRequired: true });
    expect(
      validateProfile(
        {
          ...ok,
          sourceOfFunds: ['SALARY', 'INHERITANCE'],
          sourceOfFundsExplanation: 'late father',
        },
        rb,
      ),
    ).toEqual({ evidenceRequired: true });
  });
  it('rejects unknown values, duplicates and missing explanations', () => {
    expect(() =>
      validateProfile({ ...ok, occupation: 'ASTRONAUT' }, rb),
    ).toThrow(ValidationError);
    expect(() =>
      validateProfile({ ...ok, annualIncomeBand: 'LOTS' }, rb),
    ).toThrow(ValidationError);
    expect(() => validateProfile({ ...ok, sourceOfFunds: [] }, rb)).toThrow(
      ValidationError,
    );
    expect(() =>
      validateProfile({ ...ok, sourceOfFunds: ['SALARY', 'SALARY'] }, rb),
    ).toThrow(ValidationError);
    expect(() =>
      validateProfile({ ...ok, sourceOfFunds: ['OTHER'] }, rb),
    ).toThrow(ValidationError);
    expect(() =>
      validateProfile(
        { ...ok, sourceOfFunds: ['OTHER'], sourceOfFundsExplanation: ' ' },
        rb,
      ),
    ).toThrow(ValidationError);
  });
});

describe('validateDeclarations', () => {
  const rb = loadTaxRulebook();
  const pan = 'ABCPE1234F';
  const base = {
    taxResidencies: [{ country: 'IN', tin: 'abcpe1234f' }],
    pepDeclaration: 'NOT_PEP',
    declarationVersion: 'declarations_v1',
  };
  it('accepts a resident with a matching PAN; foreign residency requires follow-up', () => {
    expect(validateDeclarations(base, pan, true, rb)).toEqual({
      additionalInformationRequired: false,
    });
    expect(
      validateDeclarations(
        {
          ...base,
          taxResidencies: [
            ...base.taxResidencies,
            { country: 'us', tin: '123-45-6789' },
          ],
        },
        pan,
        true,
        rb,
      ),
    ).toEqual({ additionalInformationRequired: true });
    expect(
      validateDeclarations(
        {
          ...base,
          taxResidencies: [
            ...base.taxResidencies,
            {
              country: 'AE',
              tin: null,
              tinUnavailableReason: 'COUNTRY_DOES_NOT_ISSUE_TIN',
            },
          ],
        },
        pan,
        true,
        rb,
      ).additionalInformationRequired,
    ).toBe(true);
  });
  it('rejects a mismatching Indian TIN, missing home country, bad countries, missing TIN reasons, bad PEP values', () => {
    expect(() =>
      validateDeclarations(
        { ...base, taxResidencies: [{ country: 'IN', tin: 'ZZZZZ9999Z' }] },
        pan,
        true,
        rb,
      ),
    ).toThrow(/match the verified PAN/);
    expect(() =>
      validateDeclarations(
        { ...base, taxResidencies: [{ country: 'US', tin: '1' }] },
        pan,
        true,
        rb,
      ),
    ).toThrow(ValidationError);
    expect(
      validateDeclarations(
        { ...base, taxResidencies: [{ country: 'US', tin: '1' }] },
        pan,
        false,
        rb,
      ).additionalInformationRequired,
    ).toBe(true);
    expect(() =>
      validateDeclarations(
        { ...base, taxResidencies: [{ country: 'USA', tin: '1' }] },
        pan,
        true,
        rb,
      ),
    ).toThrow(ValidationError);
    expect(() =>
      validateDeclarations(
        {
          ...base,
          taxResidencies: [
            { country: 'IN', tin: pan },
            { country: 'IN', tin: pan },
          ],
        },
        pan,
        true,
        rb,
      ),
    ).toThrow(ValidationError);
    expect(() =>
      validateDeclarations(
        {
          ...base,
          taxResidencies: [{ country: 'IN', tin: pan }, { country: 'GB' }],
        },
        pan,
        true,
        rb,
      ),
    ).toThrow(ValidationError);
    expect(() =>
      validateDeclarations(
        {
          ...base,
          taxResidencies: [
            { country: 'IN', tin: pan },
            { country: 'GB', tinUnavailableReason: 'LOST_IT' },
          ],
        },
        pan,
        true,
        rb,
      ),
    ).toThrow(ValidationError);
    expect(() =>
      validateDeclarations({ ...base, pepDeclaration: 'MAYBE' }, pan, true, rb),
    ).toThrow(ValidationError);
    expect(() =>
      validateDeclarations({ ...base, declarationVersion: '' }, pan, true, rb),
    ).toThrow(ValidationError);
    expect(() =>
      validateDeclarations({ ...base, taxResidencies: [] }, pan, true, rb),
    ).toThrow(ValidationError);
    expect(() =>
      validateDeclarations(
        {
          ...base,
          taxResidencies: Array.from({ length: 5 }, () => ({
            country: 'IN',
            tin: pan,
          })),
        },
        pan,
        true,
        rb,
      ),
    ).toThrow(ValidationError);
  });
});

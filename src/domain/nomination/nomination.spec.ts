import { ValidationError } from '../../common/errors/app-error';
import { loadNominationRulebook, validateNomination } from './nomination';

describe('validateNomination', () => {
  const rb = loadNominationRulebook();
  const spouse = {
    fullName: 'Asha Singh',
    relationship: 'SPOUSE',
    isMinor: false,
  };
  it('opt-out is explicit and carries no nominees', () => {
    expect(validateNomination({ choice: 'OPT_OUT', nominees: [] }, rb)).toEqual(
      [],
    );
    expect(() =>
      validateNomination({ choice: 'OPT_OUT', nominees: [spouse] }, rb),
    ).toThrow(ValidationError);
    expect(() =>
      validateNomination({ choice: 'MAYBE' as never, nominees: [] }, rb),
    ).toThrow(ValidationError);
  });
  it('equal allocation splits with the remainder on the first nominee', () => {
    const out = validateNomination(
      {
        choice: 'NOMINATE',
        allocationMode: 'EQUAL',
        nominees: [
          spouse,
          { ...spouse, fullName: 'Ravi Singh', relationship: 'SON' },
          { ...spouse, fullName: 'Meera Singh', relationship: 'DAUGHTER' },
        ],
      },
      rb,
    );
    expect(out.map((n) => n.allocationPercent)).toEqual([34, 33, 33]);
    expect(
      validateNomination({ choice: 'NOMINATE', nominees: [spouse] }, rb)[0]
        .allocationPercent,
    ).toBe(100);
  });
  it('custom allocation must be positive integers summing to 100', () => {
    expect(
      validateNomination(
        {
          choice: 'NOMINATE',
          allocationMode: 'CUSTOM',
          nominees: [
            { ...spouse, allocationPercent: 60 },
            {
              ...spouse,
              fullName: 'Ravi',
              relationship: 'SON',
              allocationPercent: 40,
            },
          ],
        },
        rb,
      ),
    ).toHaveLength(2);
    expect(() =>
      validateNomination(
        {
          choice: 'NOMINATE',
          allocationMode: 'CUSTOM',
          nominees: [
            { ...spouse, allocationPercent: 60 },
            {
              ...spouse,
              fullName: 'Ravi',
              relationship: 'SON',
              allocationPercent: 39,
            },
          ],
        },
        rb,
      ),
    ).toThrow(ValidationError);
    expect(() =>
      validateNomination(
        {
          choice: 'NOMINATE',
          allocationMode: 'CUSTOM',
          nominees: [{ ...spouse, allocationPercent: 100.5 }],
        },
        rb,
      ),
    ).toThrow(ValidationError);
    expect(() =>
      validateNomination(
        {
          choice: 'NOMINATE',
          allocationMode: 'HALF' as never,
          nominees: [spouse],
        },
        rb,
      ),
    ).toThrow(ValidationError);
  });
  it('minors need a date of birth and a guardian; names, relationships and counts are validated', () => {
    const minor = { fullName: 'Kid Singh', relationship: 'SON', isMinor: true };
    expect(() =>
      validateNomination({ choice: 'NOMINATE', nominees: [minor] }, rb),
    ).toThrow(ValidationError);
    expect(() =>
      validateNomination(
        {
          choice: 'NOMINATE',
          nominees: [{ ...minor, dateOfBirth: '2015-05-05' }],
        },
        rb,
      ),
    ).toThrow(ValidationError);
    expect(
      validateNomination(
        {
          choice: 'NOMINATE',
          nominees: [
            {
              ...minor,
              dateOfBirth: '2015-05-05',
              guardian: { fullName: 'Asha Singh', relationship: 'MOTHER' },
            },
          ],
        },
        rb,
      ),
    ).toHaveLength(1);
    expect(() =>
      validateNomination(
        { choice: 'NOMINATE', nominees: [{ ...spouse, fullName: '1' }] },
        rb,
      ),
    ).toThrow(ValidationError);
    expect(() =>
      validateNomination(
        { choice: 'NOMINATE', nominees: [{ ...spouse, relationship: 'PET' }] },
        rb,
      ),
    ).toThrow(ValidationError);
    expect(() =>
      validateNomination({ choice: 'NOMINATE', nominees: [] }, rb),
    ).toThrow(ValidationError);
    expect(() =>
      validateNomination(
        { choice: 'NOMINATE', nominees: [spouse, spouse, spouse, spouse] },
        rb,
      ),
    ).toThrow(ValidationError);
  });
});

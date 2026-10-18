import { ValidationError } from '../../common/errors/app-error';
import {
  bankNextScreen,
  evaluateBankOutcome,
  loadBankRulebook,
  maskAccount,
  normaliseAccountNumber,
  normaliseIfsc,
} from './bank-account';

describe('bank account domain', () => {
  const rb = loadBankRulebook();
  it('normalises and validates account numbers and IFSCs', () => {
    expect(normaliseAccountNumber(' 1234 5678 9012 ')).toBe('123456789012');
    expect(() => normaliseAccountNumber('12345')).toThrow(ValidationError);
    expect(() => normaliseAccountNumber('12ab5678')).toThrow(ValidationError);
    expect(normaliseIfsc(' hdfc0001234 ')).toBe('HDFC0001234');
    expect(() => normaliseIfsc('HDFC1001234')).toThrow(ValidationError);
    expect(maskAccount('123456789012')).toBe('••••9012');
  });
  it('evaluates provider outcomes against the thresholds', () => {
    expect(
      evaluateBankOutcome({ verified: true, fuzzyMatchScore: 90 }, rb),
    ).toEqual({ status: 'VERIFIED' });
    expect(
      evaluateBankOutcome({ verified: true, fuzzyMatchScore: 70 }, rb),
    ).toEqual({ status: 'VERIFIED' });
    expect(
      evaluateBankOutcome({ verified: true, fuzzyMatchScore: 55 }, rb),
    ).toEqual({ status: 'REVIEW_REQUIRED', category: 'name_match_low' });
    expect(
      evaluateBankOutcome({ verified: true, fuzzyMatchScore: 10 }, rb),
    ).toMatchObject({
      status: 'ACTION_REQUIRED',
      category: 'name_mismatch',
      requiredActions: ['CORRECT_DETAILS', 'UPLOAD_BANK_PROOF'],
    });
    expect(evaluateBankOutcome({ verified: true }, rb)).toMatchObject({
      status: 'REVIEW_REQUIRED',
      category: 'name_match_unavailable',
    });
    expect(
      evaluateBankOutcome({ verified: false, errorCode: 'E1' }, rb),
    ).toMatchObject({
      status: 'ACTION_REQUIRED',
      category: 'account_not_verified',
    });
  });
  it('maps statuses to screens', () => {
    expect(bankNextScreen('VERIFIED')).toBe('NOMINATION');
    expect(bankNextScreen('ACTION_REQUIRED')).toBe('BANK_DETAILS');
    expect(bankNextScreen('REVIEW_REQUIRED')).toBe('ASSISTED_ONBOARDING');
    expect(bankNextScreen('PROCESSING')).toBe('BANK_PROGRESS');
    expect(bankNextScreen('TECHNICAL_ERROR')).toBe('BANK_PROGRESS');
  });
});

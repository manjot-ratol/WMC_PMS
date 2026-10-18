import { ValidationError } from '../../common/errors/app-error';
import { toIsoDate } from '../shared/iso-date';
import {
  isAdult,
  normaliseLegalName,
  normalisePan,
  panHolderType,
} from './identity-version';
import { kycNextScreen, routeKyc } from './kyc-record';
import { loadKycRelianceRulebook } from './kyc-reliance-rulebook';
import { evaluateProviderStatus } from './kyc-session';

describe('identity normalisation', () => {
  it('normalises PAN and legal name, rejects bad input', () => {
    expect(normalisePan(' abcpe1234f ')).toBe('ABCPE1234F');
    expect(() => normalisePan('ABC')).toThrow(ValidationError);
    expect(normaliseLegalName("  Vinod  Kumar O'Brien-Singh ")).toBe(
      "Vinod Kumar O'Brien-Singh",
    );
    expect(() => normaliseLegalName('V')).toThrow(ValidationError);
    expect(() => normaliseLegalName('123')).toThrow(ValidationError);
    expect(panHolderType('ABCPE1234F')).toBe('INDIVIDUAL');
    expect(panHolderType('ABCCE1234F')).toBe('OTHER');
  });
  it('isAdult uses the 18th birthday', () => {
    const now = new Date('2026-10-18T00:00:00Z');
    expect(isAdult(toIsoDate('2008-10-18'), now)).toBe(true);
    expect(isAdult(toIsoDate('2008-10-19'), now)).toBe(false);
  });
});

describe('routeKyc', () => {
  const rb = loadKycRelianceRulebook();
  const now = new Date('2026-10-18T00:00:00Z');
  it('routes validated records to REUSE and others per rulebook', () => {
    expect(
      routeKyc(
        { found: true, statusCode: '007', statusDate: toIsoDate('2023-06-02') },
        rb,
        now,
      ),
    ).toMatchObject({ status: 'EXISTING_RECORD_AVAILABLE', route: 'REUSE' });
    expect(routeKyc({ found: true, statusCode: '107' }, rb, now).route).toBe(
      'REUSE',
    );
    expect(routeKyc({ found: true, statusCode: '002' }, rb, now)).toMatchObject(
      { status: 'EXISTING_RECORD_AVAILABLE', route: 'REMEDIATE' },
    );
    expect(routeKyc({ found: true, statusCode: '001' }, rb, now)).toMatchObject(
      { status: 'NO_RECORD', route: 'FRESH' },
    );
    expect(routeKyc({ found: false }, rb, now)).toMatchObject({
      status: 'NO_RECORD',
      route: 'FRESH',
    });
    expect(
      routeKyc({ found: true, errorCode: 'ERR-90079' }, rb, now).route,
    ).toBe('FRESH');
  });
  it('unknown or malformed codes go to review, never reuse', () => {
    expect(routeKyc({ found: true, statusCode: '099' }, rb, now)).toMatchObject(
      { status: 'REVIEW_REQUIRED', route: 'ASSISTED' },
    );
    expect(routeKyc({ found: true, statusCode: 'ok' }, rb, now).route).toBe(
      'ASSISTED',
    );
    expect(routeKyc({ found: true }, rb, now).route).toBe('ASSISTED');
  });
  it('old records and missing ipv (when required) remediate', () => {
    expect(
      routeKyc(
        { found: true, statusCode: '007', statusDate: toIsoDate('2000-01-01') },
        rb,
        now,
      ).route,
    ).toBe('REMEDIATE');
    expect(
      routeKyc(
        { found: true, statusCode: '007', ipvFlag: 'N' },
        { ...rb, requireIpvFlagForReuse: true },
        now,
      ).route,
    ).toBe('REMEDIATE');
  });
  it('kycNextScreen maps statuses and routes', () => {
    expect(kycNextScreen({ status: 'PROCESSING' })).toBe('KYC_PROGRESS');
    expect(kycNextScreen({ status: 'TECHNICAL_ERROR' })).toBe('KYC_PROGRESS');
    expect(kycNextScreen({ status: 'COMPLETE' })).toBe('PROFILE');
    expect(
      kycNextScreen({ status: 'EXISTING_RECORD_AVAILABLE', route: 'REUSE' }),
    ).toBe('CONFIRM_KYC');
    expect(
      kycNextScreen({
        status: 'EXISTING_RECORD_AVAILABLE',
        route: 'REMEDIATE',
      }),
    ).toBe('FRESH_KYC');
    expect(kycNextScreen({ status: 'NO_RECORD', route: 'FRESH' })).toBe(
      'FRESH_KYC',
    );
    expect(
      kycNextScreen({ status: 'REVIEW_REQUIRED', route: 'ASSISTED' }),
    ).toBe('ASSISTED_ONBOARDING');
    expect(kycNextScreen({ status: 'NO_RECORD' })).toBe('KYC_PROGRESS');
  });
});

describe('evaluateProviderStatus', () => {
  it('requested with all actions success is still in progress', () => {
    expect(
      evaluateProviderStatus({
        requestStatus: 'requested',
        actions: [{ status: 'success', processingDone: true }],
      }),
    ).toEqual({ outcome: 'IN_PROGRESS' });
  });
  it('approved completes only when mandatory actions succeeded and processing is done', () => {
    expect(
      evaluateProviderStatus({
        requestStatus: 'approved',
        actions: [
          { status: 'success', processingDone: true },
          { status: 'skipped', optional: true },
        ],
      }),
    ).toEqual({ outcome: 'COMPLETED' });
    expect(
      evaluateProviderStatus({
        requestStatus: 'approved',
        actions: [{ status: 'skipped' }],
      }),
    ).toEqual({ outcome: 'APPROVAL_PENDING' });
    expect(
      evaluateProviderStatus({
        requestStatus: 'approved',
        actions: [{ status: 'success', processingDone: false }],
      }),
    ).toEqual({ outcome: 'APPROVAL_PENDING' });
  });
  it('terminal statuses map to categories', () => {
    expect(
      evaluateProviderStatus({ requestStatus: 'rejected', actions: [] }),
    ).toEqual({
      outcome: 'TERMINAL',
      status: 'REJECTED',
      category: 'provider_rejected',
    });
    expect(
      evaluateProviderStatus({ requestStatus: 'expired', actions: [] }),
    ).toMatchObject({ status: 'EXPIRED' });
    expect(
      evaluateProviderStatus({ requestStatus: 'failed', actions: [] }),
    ).toMatchObject({ status: 'FAILED' });
    expect(
      evaluateProviderStatus({
        requestStatus: 'approval_pending',
        actions: [],
      }),
    ).toEqual({ outcome: 'APPROVAL_PENDING' });
  });
});

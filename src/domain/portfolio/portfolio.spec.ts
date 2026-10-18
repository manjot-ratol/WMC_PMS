import { classifyScheme, maskFolio, parseCasSummary } from './cas-parser';
import {
  effectiveStatus,
  evaluateCallback,
  importNextScreen,
  isOpen,
} from './portfolio-import';

const now = new Date('2026-10-19T10:00:00Z');

describe('portfolio import domain', () => {
  it('reads an open import past expiry as EXPIRED without writing', () => {
    const open = {
      status: 'AWAITING_AUTHORISATION' as const,
      expiresAt: new Date(now.getTime() + 1),
    };
    expect(effectiveStatus(open, now)).toBe('AWAITING_AUTHORISATION');
    expect(isOpen(open, now)).toBe(true);
    const stale = { ...open, expiresAt: now };
    expect(effectiveStatus(stale, now)).toBe('EXPIRED');
    expect(isOpen(stale, now)).toBe(false);
    expect(effectiveStatus({ status: 'IMPORTED', expiresAt: now }, now)).toBe(
      'IMPORTED',
    );
  });

  it('routes to the dashboard only when imported, otherwise stays until the step completes', () => {
    expect(importNextScreen('IMPORTED', true, 'KYC_PROGRESS')).toBe(
      'ASSETS_DASHBOARD',
    );
    expect(importNextScreen('FAILED', false, 'KYC_PROGRESS')).toBe(
      'PORTFOLIO_IMPORT',
    );
    expect(importNextScreen(undefined, false, 'KYC_PROGRESS')).toBe(
      'PORTFOLIO_IMPORT',
    );
    expect(importNextScreen('SKIPPED', true, 'CONFIRM_KYC')).toBe(
      'CONFIRM_KYC',
    );
    expect(importNextScreen('DECLINED', true, 'CONFIRM_KYC')).toBe(
      'CONFIRM_KYC',
    );
  });

  it('evaluates the callback conservatively', () => {
    expect(evaluateCallback({ status: 'SUCCESS', response: 'abc' })).toEqual({
      outcome: 'AUTHORISED',
      cipher: 'abc',
    });
    expect(evaluateCallback({ status: 'success', data: 'abc' })).toEqual({
      outcome: 'AUTHORISED',
      cipher: 'abc',
    });
    expect(evaluateCallback({ casData: 'abc' })).toEqual({
      outcome: 'AUTHORISED',
      cipher: 'abc',
    });
    expect(evaluateCallback({ status: 'FAILED', response: 'abc' })).toEqual({
      outcome: 'DECLINED',
      category: 'authorisation_declined',
    });
    expect(evaluateCallback({ status: 'declined' })).toEqual({
      outcome: 'DECLINED',
      category: 'authorisation_declined',
    });
    expect(evaluateCallback({ status: 'SUCCESS' })).toEqual({
      outcome: 'INVALID',
      category: 'invalid_payload',
    });
    expect(evaluateCallback({})).toEqual({
      outcome: 'INVALID',
      category: 'invalid_payload',
    });
  });
});

describe('CAS parser', () => {
  const sample = {
    reqId: '123',
    clientRefNo: 'pi_1',
    data: {
      asOf: '2026-10-18',
      investor: { name: 'VINOD KUMAR SINGH', pan: 'ABJPX1234J' },
      folios: [
        {
          amc: 'JioBlackRock Mutual Fund',
          folio: '1234567/89',
          schemes: [
            {
              schemeName: 'JioBlackRock Flexi Cap Fund - Direct Growth',
              isin: 'INF000000001',
              schemeType: 'Equity',
              units: '1,000.5',
              nav: 25.1,
              navDate: '2026-10-17',
              marketValue: '25,112.55',
              costValue: 20000,
            },
            {
              schemeName: 'JioBlackRock Liquid Fund - Direct Growth',
              isin: 'INF000000002',
              schemeType: 'Debt',
              units: 10,
              nav: 1000,
              marketValue: 10000,
              costValue: 9900,
            },
          ],
        },
        {
          amc: 'Other AMC',
          folio: '99',
          schemes: [
            {
              schemeName: 'Other Balanced Advantage',
              category: 'Hybrid',
              units: 2,
              nav: 50,
            },
          ],
        },
        { amc: 'Skip AMC', folio: '1', schemes: [{ schemeName: 'No units' }] },
      ],
    },
  };

  it('normalises folios, masks identifiers and totals by asset class', () => {
    const p = parseCasSummary(sample, { pan: 'ABJPX1234J', asOf: now });
    expect(p.source).toBe('MFCENTRAL');
    expect(p.asOf).toBe('2026-10-18');
    expect(p.investor).toEqual({
      name: 'VINOD KUMAR SINGH',
      panMasked: 'AB••••••4J',
    });
    expect(p.holdings).toHaveLength(3);
    expect(p.holdings[0]).toMatchObject({
      amc: 'JioBlackRock Mutual Fund',
      folioMasked: '••••7/89',
      assetClass: 'EQUITY',
      units: 1000.5,
      nav: 25.1,
      marketValueInr: 25112.55,
      costValueInr: 20000,
    });
    expect(p.holdings[2]).toMatchObject({
      assetClass: 'HYBRID',
      marketValueInr: 100,
      nav: 50,
      costValueInr: undefined,
    });
    expect(p.totals).toEqual({
      marketValueInr: 35212.55,
      costValueInr: 29900,
      gainInr: 5312.55,
      gainPct: 17.8,
      folioCount: 2,
      schemeCount: 3,
    });
    expect(p.byAssetClass.map((s) => [s.assetClass, s.weightPct])).toEqual([
      ['EQUITY', 71.3],
      ['DEBT', 28.4],
      ['HYBRID', 0.3],
    ]);
    expect(JSON.stringify(p)).not.toContain('1234567');
    expect(JSON.stringify(p)).not.toContain('ABJPX1234J');
  });

  it('accepts a flat holdings list and an empty statement; rejects anything else', () => {
    const flat = parseCasSummary(
      {
        holdings: [
          {
            amcName: 'X',
            folioNo: '42',
            scheme: 'X Index Fund',
            balanceUnits: 3,
            latestNav: 10,
          },
        ],
      },
      { pan: 'ABJPX1234J', asOf: now },
    );
    expect(flat.holdings[0]).toMatchObject({
      amc: 'X',
      folioMasked: '••••42',
      assetClass: 'EQUITY',
      marketValueInr: 30,
    });
    const empty = parseCasSummary(
      { data: { folios: [] } },
      { pan: 'ABJPX1234J', asOf: now },
    );
    expect(empty.totals).toEqual({
      marketValueInr: 0,
      costValueInr: undefined,
      gainInr: undefined,
      gainPct: undefined,
      folioCount: 0,
      schemeCount: 0,
    });
    expect(empty.asOf).toBe('2026-10-19');
    expect(() =>
      parseCasSummary('nope', { pan: 'ABJPX1234J', asOf: now }),
    ).toThrow('not_an_object');
    expect(() =>
      parseCasSummary({ reqId: '1' }, { pan: 'ABJPX1234J', asOf: now }),
    ).toThrow('no_holdings_section');
  });

  it('classifies schemes and masks folios', () => {
    expect(classifyScheme('ELSS Tax Saver')).toBe('EQUITY');
    expect(classifyScheme('Overnight Fund')).toBe('DEBT');
    expect(classifyScheme('Balanced Advantage')).toBe('HYBRID');
    expect(classifyScheme('Gold Fund of Funds')).toBe('OTHER');
    expect(classifyScheme(undefined)).toBe('OTHER');
    expect(maskFolio('12 34')).toBe('••••1234');
  });
});

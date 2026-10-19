import * as fs from 'node:fs';
import * as path from 'node:path';
import { classifyScheme, maskFolio, parseCasSummary } from './cas-parser';
import {
  effectiveStatus,
  evaluateReturn,
  importNextScreen,
  isOpen,
} from './portfolio-import';

const now = new Date('2026-10-19T10:00:00Z');
const fixture = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      '../../../test/fixtures/mfcentral/cas-summary.sample.json',
    ),
    'utf8',
  ),
) as Record<string, unknown>;

describe('portfolio import domain', () => {
  it('reads an open import past expiry as EXPIRED without writing', () => {
    const open = {
      status: 'AWAITING_AUTHORISATION' as const,
      expiresAt: new Date(now.getTime() + 1),
    };
    expect(effectiveStatus(open, now)).toBe('AWAITING_AUTHORISATION');
    expect(isOpen(open, now)).toBe(true);
    expect(
      isOpen(
        { status: 'AWAITING_QR', expiresAt: new Date(now.getTime() + 1) },
        now,
      ),
    ).toBe(true);
    expect(effectiveStatus({ ...open, expiresAt: now }, now)).toBe('EXPIRED');
    expect(
      effectiveStatus({ status: 'AWAITING_QR', expiresAt: now }, now),
    ).toBe('EXPIRED');
    expect(effectiveStatus({ status: 'IMPORTED', expiresAt: now }, now)).toBe(
      'IMPORTED',
    );
  });

  it('routes to the dashboard only when imported, otherwise stays until the step completes', () => {
    expect(importNextScreen('IMPORTED', true, 'KYC_PROGRESS')).toBe(
      'ASSETS_DASHBOARD',
    );
    expect(importNextScreen('AWAITING_QR', false, 'KYC_PROGRESS')).toBe(
      'PORTFOLIO_IMPORT',
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

  it('evaluates the return leg the way the consent app sends it', () => {
    expect(
      evaluateReturn({ status: 'success', reqId: '3400488', type: 'Summary' }),
    ).toEqual({
      outcome: 'SUCCESS',
      reqId: '3400488',
      type: 'Summary',
    });
    expect(evaluateReturn({ status: 'SUCCESS', reqid: '1' })).toEqual({
      outcome: 'SUCCESS',
      reqId: '1',
      type: undefined,
    });
    expect(
      evaluateReturn({
        status: 'error',
        code: 'ERR_SESSION',
        message: 'expired',
      }),
    ).toEqual({
      outcome: 'ERROR',
      reqId: undefined,
      code: 'ERR_SESSION',
      message: 'expired',
    });
    expect(evaluateReturn({ status: 'success' })).toEqual({
      outcome: 'INVALID',
    });
    expect(evaluateReturn({})).toEqual({ outcome: 'INVALID' });
  });
});

describe('CAS parser (MF Central validateQRCode statement)', () => {
  it('normalises the real UAT statement: strings and numbers, closed folios dropped, masked, partial flag', () => {
    const p = parseCasSummary(fixture, { pan: 'AQQPS7576R', asOf: now });
    expect(p.source).toBe('MFCENTRAL');
    expect(p.asOf).toBe('2026-10-19');
    expect(p.investor).toEqual({
      name: 'IXAZDQGYSECB',
      panMasked: 'AQ••••••6R',
    });
    // 9 scheme rows in the fixture, 2 are closed (no units, no value)
    expect(p.holdings).toHaveLength(7);
    expect(p.holdings[0]).toEqual({
      amc: 'MFHMF Test Fund',
      amcCode: 'H',
      schemeName: 'HDFC Balanced Advantage Fund - Regular Plan - Growth',
      schemeType: 'Balanced',
      isin: 'INF179K01830',
      folioMasked: '••••7225',
      assetClass: 'EQUITY',
      plan: 'REGULAR',
      units: 50000,
      nav: 10,
      navDate: '15-Oct-2026',
      marketValueInr: 500000,
      costValueInr: 33000,
      gainInr: 467000,
      gainPct: 1415.15,
      rta: 'CAMS',
      demat: false,
    });
    const kfin = p.holdings.find((h) => h.isin === 'INF843K01AO4')!;
    expect(kfin).toMatchObject({
      amc: 'EDELWEISS MUTUAL FUND',
      plan: 'DIRECT',
      units: 29060.619,
      marketValueInr: 3769685.38,
      rta: 'KFIN',
    });
    expect(p.holdings.map((h) => h.assetClass)).toEqual([
      'EQUITY',
      'EQUITY',
      'DEBT',
      'EQUITY',
      'CASH',
      'EQUITY',
      'DEBT',
    ]);
    expect(p.totals).toEqual({
      marketValueInr: 21009690.85,
      costValueInr: 5494914.42,
      gainInr: 15514776.43,
      gainPct: 282.3,
      folioCount: 6,
      schemeCount: 7,
    });
    expect(p.reportedTotals).toEqual({
      marketValueInr: 3762564236369.78,
      costValueInr: 4263599062.2,
    });
    expect(p.byAssetClass.map((s) => s.assetClass)).toEqual([
      'EQUITY',
      'CASH',
      'DEBT',
    ]);
    expect(
      p.byAssetClass[0].weightPct +
        p.byAssetClass[1].weightPct +
        p.byAssetClass[2].weightPct,
    ).toBeCloseTo(100, 0);
    expect(p.byAmc).toEqual([
      {
        amc: 'MFHMF Test Fund',
        marketValueInr: 17233450,
        weightPct: 82,
        schemeCount: 5,
      },
      {
        amc: 'EDELWEISS MUTUAL FUND',
        marketValueInr: 3776240.85,
        weightPct: 18,
        schemeCount: 2,
      },
    ]);
    expect(p.partial).toBe(true);
    expect(p.notice).toContain('partially');
    const json = JSON.stringify(p);
    expect(json).not.toContain('AQQPS7576R');
    expect(json).not.toContain('17057225');
    expect(json).not.toContain('accountNo');
    expect(json).not.toContain('AZOAJBUGBUTC');
  });

  it('accepts an empty statement and rejects anything that is not one', () => {
    const empty = parseCasSummary(
      { reqId: '1', data: [{ summary: [], schemes: [] }] },
      { pan: 'ABJPX1234J', asOf: now },
    );
    expect(empty.holdings).toEqual([]);
    expect(empty.totals).toEqual({
      marketValueInr: 0,
      costValueInr: undefined,
      gainInr: undefined,
      gainPct: undefined,
      folioCount: 0,
      schemeCount: 0,
    });
    expect(empty.partial).toBe(false);
    expect(empty.byAmc).toEqual([]);
    expect(() =>
      parseCasSummary('nope', { pan: 'ABJPX1234J', asOf: now }),
    ).toThrow('not_an_object');
    expect(() =>
      parseCasSummary({ reqId: '1' }, { pan: 'ABJPX1234J', asOf: now }),
    ).toThrow('no_data_section');
    const odd = parseCasSummary(
      {
        data: [
          'junk',
          {
            schemes: [
              'junk',
              {
                schemeName: 'X Fund',
                closingBalance: '1',
                currentMktValue: 'abc',
                assetType: 'weird',
                schemeType: 'Gilt',
                planMode: 'X',
                isDemat: 'Y',
              },
            ],
          },
        ],
      },
      { pan: 'ABJPX1234J', asOf: now },
    );
    expect(odd.holdings[0]).toMatchObject({
      amc: 'UNKNOWN',
      assetClass: 'DEBT',
      plan: undefined,
      marketValueInr: 0,
      nav: 0,
      demat: true,
      folioMasked: '••••',
    });
  });

  it('classifies schemes and masks folios', () => {
    expect(classifyScheme('ELSS Tax Saver')).toBe('EQUITY');
    expect(classifyScheme('Overnight Fund')).toBe('CASH');
    expect(classifyScheme('Balanced Advantage')).toBe('HYBRID');
    expect(classifyScheme('Ultra Liquid')).toBe('CASH');
    expect(classifyScheme('FMP(CE)')).toBe('DEBT');
    expect(classifyScheme('Something Else')).toBe('OTHER');
    expect(classifyScheme(undefined)).toBe('OTHER');
    expect(maskFolio('12 34')).toBe('••••1234');
  });
});

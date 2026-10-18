import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseIgnosisAnalytics } from './ignosis.parser';

const sample = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../../../test/fixtures/ignosis/analytics.sample.json',
  ),
  'utf8',
);

describe('parseIgnosisAnalytics', () => {
  it('types the documented sections, coerces numeric strings, and lists what it did not type', () => {
    const a = parseIgnosisAnalytics(sample);
    expect(a.overallAnalysis).toMatchObject({
      totalCreditAmount: 1250000.5,
      totalDebitAmount: 980000,
      extra: { averageBalance: 310000 },
    });
    expect(a.overallAnalysis!.monthlyAnalytics).toHaveLength(2);
    expect(a.overallAnalysis!.dailyAnalytics[0]).toMatchObject({
      date: '2026-09-01',
      endOfDayBalance: 305000,
    });
    expect(a.accountWiseAnalysis[0]).toMatchObject({
      accountNumber: 'XXXX5678',
      bank: 'HDFC',
      totalCreditAmount: 1250000.5,
    });
    expect(a.salary!.overall).toMatchObject({
      identified: true,
      totalIncomeAmountLast90Days: 450000,
    });
    expect(a.salary!.accountWise).toHaveLength(1);
    expect(a.emi!.overall!.totalObligationAmountLast90Days).toBe(90000);
    expect(a.loanCreditSummary).toMatchObject({
      totalLoanCreditAmount: 0,
      totalLoanCreditTxns: 0,
    });
    expect(a.abb!.overall).toEqual({
      averageOfMonthlyAverages: 287500.25,
      monthlyData: [280000, 295000.5],
    });
    expect(a.score).toBe(712);
    expect(a.mutualFunds).toMatchObject({
      totalPortfolioValue: 2350000,
      absolutePercentageReturn: 17.5,
    });
    expect(a.equity!.totalPortfolioValue).toBe(540000);
    expect(a.fixedDeposits).toBeUndefined();
    expect(a.nudges[0]).toMatchObject({ nudgeId: 'n1', type: 'INCOME' });
    expect(a.personas).toEqual(['Steady Earner', 'Investor']);
    expect(a.transactionCount).toBe(2);
    expect(a.untypedSections).toEqual(['bounceAnalysis', 'fcuIndicators']);
  });
  it('missing sections stay undefined; malformed roots and odd shapes are tolerated or rejected explicitly', () => {
    const a = parseIgnosisAnalytics({
      accountWiseAnalysis: 'nope',
      score: { band: 'A' },
      frequentCredits: { salaryAnalysis: { overall: null } },
      profiles: [{ x: 1 }],
    });
    expect(a.overallAnalysis).toBeUndefined();
    expect(a.accountWiseAnalysis).toEqual([]);
    expect(a.score).toEqual({ band: 'A' });
    expect(a.salary).toEqual({ overall: undefined, accountWise: [] });
    expect(a.otherIncome).toBeUndefined();
    expect(a.personas).toEqual([]);
    expect(a.transactionCount).toBe(0);
    expect(() => parseIgnosisAnalytics('[]')).toThrow(/JSON object/);
    expect(() => parseIgnosisAnalytics(null)).toThrow();
  });
});

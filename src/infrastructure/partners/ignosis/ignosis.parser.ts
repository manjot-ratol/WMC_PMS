/** Typed view of the Ignosis bank-analytics JSON (Partners Documentation/Ignosis, "Json Tag" paths). Parser only. */
export interface IgnosisMonthly {
  month?: number | string;
  year?: number | string;
  totalCreditAmount?: number;
  totalDebitAmount?: number;
  [k: string]: unknown;
}
export interface IgnosisDaily {
  date?: string;
  day?: number | string;
  month?: number | string;
  year?: number | string;
  dailyOpeningBalance?: number;
  endOfDayBalance?: number;
  [k: string]: unknown;
}
export interface IgnosisOverall {
  totalCreditAmount?: number;
  totalDebitAmount?: number;
  monthlyAnalytics: IgnosisMonthly[];
  weeklyAnalytics: IgnosisMonthly[];
  dailyAnalytics: IgnosisDaily[];
  extra: Record<string, unknown>;
}
export interface IgnosisAccount extends IgnosisOverall {
  accountNumber?: string;
  bank?: string;
  linkedAccRef?: string;
}
export interface IgnosisRecurring {
  identified?: boolean;
  totalNoOfCredits?: number;
  totalNoOfDebits?: number;
  totalIncomeAmountLast90Days?: number;
  totalObligationAmountLast90Days?: number;
  [k: string]: unknown;
}
export interface IgnosisRecurringBlock {
  overall?: IgnosisRecurring;
  accountWise: IgnosisRecurring[];
}
export interface IgnosisPortfolioOverall {
  totalInvestedAmount?: number;
  totalPortfolioValue?: number;
  profitAmount?: number;
  absolutePercentageReturn?: number;
  [k: string]: unknown;
}
export interface IgnosisAnalytics {
  overallAnalysis?: IgnosisOverall;
  accountWiseAnalysis: IgnosisAccount[];
  salary?: IgnosisRecurringBlock;
  otherIncome?: IgnosisRecurringBlock;
  emi?: IgnosisRecurringBlock;
  nonEmiObligations?: IgnosisRecurringBlock;
  loanCreditSummary?: {
    totalLoanCreditAmount?: number;
    totalLoanCreditTxns?: number;
    [k: string]: unknown;
  };
  abb?: {
    overall?: { averageOfMonthlyAverages?: number; monthlyData?: unknown[] };
    accountWise?: unknown;
  };
  score?: number | Record<string, unknown>;
  mutualFunds?: IgnosisPortfolioOverall;
  equity?: IgnosisPortfolioOverall;
  fixedDeposits?: IgnosisPortfolioOverall;
  nudges: {
    nudgeId?: string;
    description?: string;
    type?: string;
    parameter?: unknown;
    nudgeLink?: string;
  }[];
  personas: string[];
  transactionCount: number;
  /** Top-level sections present in the payload that this model does not type. */
  untypedSections: string[];
  raw: Record<string, unknown>;
}

const obj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
      ? Number(v)
      : undefined;
const TYPED = new Set([
  'overallAnalysis',
  'accountWiseAnalysis',
  'frequentCredits',
  'frequentDebits',
  'loanCreditSummary',
  'abbTables',
  'score',
  'mutualFundAnalysis',
  'equityAnalysis',
  'fixedDepositAnalysis',
  'nudgeInfo',
  'profiles',
  'allTransactions',
]);

function overall(
  o: Record<string, unknown> | undefined,
): IgnosisOverall | undefined {
  if (!o) return undefined;
  const {
    monthlyAnalytics,
    weeklyAnalytics,
    dailyAnalytics,
    totalCreditAmount,
    totalDebitAmount,
    ...extra
  } = o;
  return {
    totalCreditAmount: num(totalCreditAmount),
    totalDebitAmount: num(totalDebitAmount),
    monthlyAnalytics: arr(monthlyAnalytics).map((m) => obj(m) ?? {}),
    weeklyAnalytics: arr(weeklyAnalytics).map((m) => obj(m) ?? {}),
    dailyAnalytics: arr(dailyAnalytics).map((m) => obj(m) ?? {}),
    extra,
  };
}
function recurring(
  o: Record<string, unknown> | undefined,
): IgnosisRecurringBlock | undefined {
  if (!o) return undefined;
  return {
    overall: obj(o.overall),
    accountWise: arr(o.accountWise).map(
      (a) => (obj(a) ?? {}) as IgnosisRecurring,
    ),
  };
}
function portfolio(
  o: Record<string, unknown> | undefined,
): IgnosisPortfolioOverall | undefined {
  const ov = obj(o?.overallAnalysis);
  return ov
    ? {
        ...ov,
        totalInvestedAmount: num(ov.totalInvestedAmount),
        totalPortfolioValue: num(ov.totalPortfolioValue),
        profitAmount: num(ov.profitAmount),
        absolutePercentageReturn: num(ov.absolutePercentageReturn),
      }
    : undefined;
}

/** Tolerant: missing sections stay undefined (never zero), unknown sections are listed, nothing is thrown for shape. */
export function parseIgnosisAnalytics(input: unknown): IgnosisAnalytics {
  const raw =
    typeof input === 'string' ? (JSON.parse(input) as unknown) : input;
  const root = obj(raw);
  if (!root) throw new Error('Ignosis analytics payload must be a JSON object');
  const credits = obj(root.frequentCredits);
  const debits = obj(root.frequentDebits);
  const abb = obj(root.abbTables);
  const nudgeInfo = obj(root.nudgeInfo);
  return {
    overallAnalysis: overall(obj(root.overallAnalysis)),
    accountWiseAnalysis: arr(root.accountWiseAnalysis).map((a) => {
      const o = obj(a) ?? {};
      return {
        ...overall(o)!,
        accountNumber:
          typeof o.accountNumber === 'string' ? o.accountNumber : undefined,
        bank: typeof o.bank === 'string' ? o.bank : undefined,
        linkedAccRef:
          typeof o.linkedAccRef === 'string' ? o.linkedAccRef : undefined,
      };
    }),
    salary: recurring(obj(credits?.salaryAnalysis)),
    otherIncome: recurring(obj(credits?.otherIncomeAnalysis)),
    emi: recurring(obj(debits?.emiAnalysis)),
    nonEmiObligations: recurring(obj(debits?.nonEmiObligationAnalysis)),
    loanCreditSummary: obj(root.loanCreditSummary)
      ? {
          ...obj(root.loanCreditSummary)!,
          totalLoanCreditAmount: num(
            obj(root.loanCreditSummary)!.totalLoanCreditAmount,
          ),
          totalLoanCreditTxns: num(
            obj(root.loanCreditSummary)!.totalLoanCreditTxns,
          ),
        }
      : undefined,
    abb: abb
      ? {
          overall: obj(abb.overall)
            ? {
                averageOfMonthlyAverages: num(
                  obj(abb.overall)!.averageOfMonthlyAverages,
                ),
                monthlyData: arr(obj(abb.overall)!.monthlyData),
              }
            : undefined,
          accountWise: abb.accountWise,
        }
      : undefined,
    score: num(root.score) ?? obj(root.score),
    mutualFunds: portfolio(obj(root.mutualFundAnalysis)),
    equity: portfolio(obj(root.equityAnalysis)),
    fixedDeposits: portfolio(obj(root.fixedDepositAnalysis)),
    nudges: arr(nudgeInfo?.nudges).map((n) => obj(n) ?? {}),
    personas: arr(root.profiles)
      .map((p) => obj(p)?.name)
      .filter((n): n is string => typeof n === 'string'),
    transactionCount: arr(root.allTransactions).length,
    untypedSections: Object.keys(root).filter((k) => !TYPED.has(k)),
    raw: root,
  };
}

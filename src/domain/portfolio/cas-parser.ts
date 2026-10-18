import { maskPan } from '../review/review-snapshot';

export type AssetClass = 'EQUITY' | 'DEBT' | 'HYBRID' | 'OTHER';

export interface PortfolioHolding {
  amc: string;
  schemeName: string;
  isin?: string;
  folioMasked: string;
  assetClass: AssetClass;
  units: number;
  nav: number;
  navDate?: string;
  marketValueInr: number;
  costValueInr?: number;
}
export interface AssetClassSlice {
  assetClass: AssetClass;
  marketValueInr: number;
  weightPct: number;
}
export interface PortfolioTotals {
  marketValueInr: number;
  costValueInr?: number;
  gainInr?: number;
  gainPct?: number;
  folioCount: number;
  schemeCount: number;
}
/** What the dashboard shows. Already masked: safe to return to the customer, never to analytics. */
export interface PortfolioSnapshotData {
  source: 'MFCENTRAL';
  asOf: string;
  investor: { name?: string; panMasked: string };
  totals: PortfolioTotals;
  byAssetClass: AssetClassSlice[];
  holdings: PortfolioHolding[];
}

export class CasParseError extends Error {
  constructor(readonly reason: string) {
    super(`CAS payload not understood: ${reason}`);
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;
const pick = (o: Obj, ...keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
};
const text = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;
const num = (v: unknown): number | undefined => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[,\s₹]/g, ''));
    return v.trim() && Number.isFinite(n) ? n : undefined;
  }
  return undefined;
};
const round2 = (n: number): number => Math.round(n * 100) / 100;
const round1 = (n: number): number => Math.round(n * 10) / 10;

export function maskFolio(folio: string): string {
  const digits = folio.replace(/\s/g, '');
  return `••••${digits.slice(-4)}`;
}

export function classifyScheme(label: string | undefined): AssetClass {
  const l = (label ?? '').toLowerCase();
  if (!l) return 'OTHER';
  if (/hybrid|balanced|asset allocation|arbitrage/.test(l)) return 'HYBRID';
  if (
    /equity|elss|index|etf|large|mid|small|flexi|multi cap|sectoral|thematic/.test(
      l,
    )
  )
    return 'EQUITY';
  if (
    /debt|liquid|bond|gilt|money market|overnight|duration|credit|income|fixed/.test(
      l,
    )
  )
    return 'DEBT';
  return 'OTHER';
}

/**
 * Normalises an MF Central CAS summary into the dashboard model. MF Central's collection carries no sample
 * statement, so the shape below is the mock's and the parser also accepts the common aliases
 * (PLACEHOLDER_PENDING_MFCENTRAL_CONFIRMATION). Unknown payloads throw rather than producing an empty portfolio.
 */
export function parseCasSummary(
  raw: unknown,
  ctx: { pan: string; asOf: Date },
): PortfolioSnapshotData {
  if (!isObj(raw)) throw new CasParseError('not_an_object');
  const containers = [raw, raw.data, raw.casData, raw.summary].filter(isObj);
  const root = containers.find((c) => findFolios(c) !== undefined) ?? raw;
  const investor = [root.investor, root.investorDetails, raw.investor].find(
    isObj,
  );
  const folios = findFolios(root);
  if (!folios) throw new CasParseError('no_holdings_section');

  const holdings: PortfolioHolding[] = [];
  const folioKeys = new Set<string>();
  for (const entry of folios) {
    if (!isObj(entry)) continue;
    const amc = text(pick(entry, 'amc', 'amcName', 'fundHouse')) ?? 'UNKNOWN';
    const folio = text(pick(entry, 'folio', 'folioNo', 'folioNumber')) ?? '';
    const schemes = pick(entry, 'schemes', 'holdings', 'schemeDetails');
    const items = Array.isArray(schemes) ? schemes : [entry];
    for (const s of items) {
      if (!isObj(s)) continue;
      const schemeName = text(pick(s, 'schemeName', 'scheme', 'name'));
      const units = num(pick(s, 'units', 'closingBalance', 'balanceUnits'));
      const nav = num(pick(s, 'nav', 'latestNav'));
      const marketValue = num(
        pick(s, 'marketValue', 'currentValue', 'valuation', 'marketValueInr'),
      );
      if (!schemeName || units === undefined) continue;
      const value =
        marketValue ?? (nav !== undefined ? round2(units * nav) : undefined);
      if (value === undefined) continue;
      const itemAmc = text(pick(s, 'amc', 'amcName')) ?? amc;
      const itemFolio = text(pick(s, 'folio', 'folioNo')) ?? folio;
      folioKeys.add(`${itemAmc}|${itemFolio}`);
      holdings.push({
        amc: itemAmc,
        schemeName,
        isin: text(pick(s, 'isin')),
        folioMasked: maskFolio(itemFolio),
        assetClass: classifyScheme(
          text(pick(s, 'assetClass', 'schemeType', 'category')) ?? schemeName,
        ),
        units,
        nav: nav ?? (units > 0 ? round2(value / units) : 0),
        navDate: text(pick(s, 'navDate', 'valuationDate')),
        marketValueInr: round2(value),
        costValueInr: num(pick(s, 'costValue', 'investedValue', 'cost')),
      });
    }
  }

  const marketValueInr = round2(
    holdings.reduce((a, h) => a + h.marketValueInr, 0),
  );
  const costs = holdings.filter((h) => h.costValueInr !== undefined);
  const costValueInr = costs.length
    ? round2(costs.reduce((a, h) => a + (h.costValueInr ?? 0), 0))
    : undefined;
  const gainInr =
    costValueInr !== undefined
      ? round2(marketValueInr - costValueInr)
      : undefined;
  const byClass = new Map<AssetClass, number>();
  for (const h of holdings)
    byClass.set(
      h.assetClass,
      (byClass.get(h.assetClass) ?? 0) + h.marketValueInr,
    );
  const byAssetClass: AssetClassSlice[] = [...byClass.entries()]
    .map(([assetClass, v]) => ({
      assetClass,
      marketValueInr: round2(v),
      weightPct: marketValueInr > 0 ? round1((v / marketValueInr) * 100) : 0,
    }))
    .sort((a, b) => b.marketValueInr - a.marketValueInr);

  return {
    source: 'MFCENTRAL',
    asOf:
      text(pick(root, 'asOf', 'asOnDate', 'statementDate')) ??
      ctx.asOf.toISOString().slice(0, 10),
    investor: {
      name: investor ? text(pick(investor, 'name', 'investorName')) : undefined,
      panMasked: maskPan(ctx.pan),
    },
    totals: {
      marketValueInr,
      costValueInr,
      gainInr,
      gainPct:
        costValueInr && gainInr !== undefined
          ? round1((gainInr / costValueInr) * 100)
          : undefined,
      folioCount: folioKeys.size,
      schemeCount: holdings.length,
    },
    byAssetClass,
    holdings,
  };
}

function findFolios(o: Obj): unknown[] | undefined {
  const v = pick(
    o,
    'folios',
    'folioList',
    'schemes',
    'holdings',
    'schemeDetails',
  );
  return Array.isArray(v) ? v : undefined;
}

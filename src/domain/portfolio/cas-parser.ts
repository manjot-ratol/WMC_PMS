import { maskPan } from '../review/review-snapshot';

export type AssetClass = 'EQUITY' | 'DEBT' | 'CASH' | 'HYBRID' | 'OTHER';

export interface PortfolioHolding {
  amc: string;
  amcCode?: string;
  schemeName: string;
  schemeType?: string;
  isin?: string;
  folioMasked: string;
  assetClass: AssetClass;
  plan?: 'DIRECT' | 'REGULAR';
  units: number;
  nav: number;
  navDate?: string;
  marketValueInr: number;
  costValueInr?: number;
  gainInr?: number;
  gainPct?: number;
  rta?: string;
  demat: boolean;
}
export interface AssetClassSlice {
  assetClass: AssetClass;
  marketValueInr: number;
  weightPct: number;
}
export interface AmcSlice {
  amc: string;
  marketValueInr: number;
  weightPct: number;
  schemeCount: number;
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
  /** Totals as MF Central reported them (non-demat line), when present. */
  reportedTotals?: { marketValueInr: number; costValueInr?: number };
  byAssetClass: AssetClassSlice[];
  byAmc: AmcSlice[];
  holdings: PortfolioHolding[];
  /** MF Central flags a statement as incomplete when an RTA lagged; the notice is their customer-facing text. */
  partial: boolean;
  notice?: string;
}

export class CasParseError extends Error {
  constructor(readonly reason: string) {
    super(`CAS payload not understood: ${reason}`);
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;
const text = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;
/** MF Central sends amounts as strings from one RTA and numbers from another. */
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
  if (/liquid|overnight|cash|money market/.test(l)) return 'CASH';
  if (/hybrid|balanced|asset allocation|arbitrage|equity savings/.test(l))
    return 'HYBRID';
  if (
    /equity|elss|index|etf|large|mid|small|flexi|multi cap|sectoral|thematic|gold/.test(
      l,
    )
  )
    return 'EQUITY';
  if (/debt|bond|gilt|duration|credit|income|fixed|fmp|stp|ultra/.test(l))
    return 'DEBT';
  return 'OTHER';
}

/** MF Central's own `assetType` wins when it is one of the known values. */
function assetClassOf(s: Obj): AssetClass {
  const given = text(s.assetType)?.toUpperCase();
  if (given === 'EQUITY' || given === 'DEBT' || given === 'CASH') return given;
  return classifyScheme(text(s.schemeType) ?? text(s.schemeName));
}
function planOf(s: Obj): 'DIRECT' | 'REGULAR' | undefined {
  const p = text(s.planMode)?.toUpperCase();
  if (!p) return undefined;
  if (p === 'D' || p === 'DIRECT') return 'DIRECT';
  if (p === 'R' || p === 'REGULAR') return 'REGULAR';
  return undefined;
}

/**
 * Normalises MF Central's `validateQRCode` statement (format confirmed on UAT 2026-10-19):
 * `{reqId, pan, data:[{summary:[…], schemes:[…]}], errorMessage, portfolio:[…], investorDetails}`.
 * Closed folios (no units and no value) are dropped; bank details and co-holder names never leave this function.
 */
export function parseCasSummary(
  raw: unknown,
  ctx: { pan: string; asOf: Date },
): PortfolioSnapshotData {
  if (!isObj(raw)) throw new CasParseError('not_an_object');
  if (!Array.isArray(raw.data)) throw new CasParseError('no_data_section');
  const holdings: PortfolioHolding[] = [];
  const folioKeys = new Set<string>();
  for (const group of raw.data) {
    if (!isObj(group) || !Array.isArray(group.schemes)) continue;
    for (const s of group.schemes) {
      if (!isObj(s)) continue;
      const schemeName = text(s.schemeName);
      const units = num(s.closingBalance) ?? 0;
      const value = num(s.currentMktValue) ?? 0;
      if (!schemeName || (units <= 0 && value <= 0)) continue;
      const amc = text(s.amcName) ?? text(s.amc) ?? 'UNKNOWN';
      const folio = text(s.folio) ?? '';
      folioKeys.add(`${amc}|${folio}`);
      const cost = num(s.costValue);
      const gain =
        num(s.gainLoss) ??
        (cost !== undefined ? round2(value - cost) : undefined);
      holdings.push({
        amc,
        amcCode: text(s.amc),
        schemeName,
        schemeType: text(s.schemeType),
        isin: text(s.isin),
        folioMasked: maskFolio(folio),
        assetClass: assetClassOf(s),
        plan: planOf(s),
        units,
        nav: num(s.nav) ?? (units > 0 ? round2(value / units) : 0),
        navDate: text(s.navDate),
        marketValueInr: round2(value),
        costValueInr: cost,
        gainInr: gain,
        gainPct: num(s.gainLossPercentage),
        rta: text(s.rtaName),
        demat: text(s.isDemat)?.toUpperCase() === 'Y',
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
  const slice = <K extends string>(key: (h: PortfolioHolding) => K) => {
    const m = new Map<K, { v: number; n: number }>();
    for (const h of holdings) {
      const cur = m.get(key(h)) ?? { v: 0, n: 0 };
      m.set(key(h), { v: cur.v + h.marketValueInr, n: cur.n + 1 });
    }
    return [...m.entries()]
      .map(([k, { v, n }]) => ({
        key: k,
        marketValueInr: round2(v),
        weightPct: marketValueInr > 0 ? round1((v / marketValueInr) * 100) : 0,
        schemeCount: n,
      }))
      .sort((a, b) => b.marketValueInr - a.marketValueInr);
  };
  const investor = isObj(raw.investorDetails) ? raw.investorDetails : undefined;
  const reported = Array.isArray(raw.portfolio)
    ? (raw.portfolio as unknown[]).find(
        (p): p is Record<string, unknown> =>
          isObj(p) && text(p.isDemat)?.toUpperCase() !== 'Y',
      )
    : undefined;
  const notice = text(raw.errorMessage)?.replace(/\s+/g, ' ');

  return {
    source: 'MFCENTRAL',
    asOf: ctx.asOf.toISOString().slice(0, 10),
    investor: {
      name: investor ? text(investor.investorName) : undefined,
      panMasked: maskPan(text(raw.pan) ?? ctx.pan),
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
    reportedTotals:
      isObj(reported) && num(reported.currentMktValue) !== undefined
        ? {
            marketValueInr: round2(num(reported.currentMktValue)!),
            costValueInr: num(reported.costValue),
          }
        : undefined,
    byAssetClass: slice((h) => h.assetClass).map(
      ({ key, marketValueInr: v, weightPct }) => ({
        assetClass: key,
        marketValueInr: v,
        weightPct,
      }),
    ),
    byAmc: slice((h) => h.amc).map(
      ({ key, marketValueInr: v, weightPct, schemeCount }) => ({
        amc: key,
        marketValueInr: v,
        weightPct,
        schemeCount,
      }),
    ),
    holdings,
    partial: Boolean(notice),
    notice,
  };
}

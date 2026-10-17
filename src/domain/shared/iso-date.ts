/** Calendar date in ISO 8601 `YYYY-MM-DD`. The canonical internal date; adapters serialise per vendor. */
export type IsoDate = string & { readonly __brand: 'IsoDate' };

const ISO_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !ISO_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function toIsoDate(value: string): IsoDate {
  if (!isIsoDate(value)) throw new RangeError(`Not a valid ISO date: ${value}`);
  return value;
}

/** DD<sep>MM<sep>YYYY, the format most Indian registries expect (KRA uses '/', KRA document download '-'). */
export function formatDdMmYyyy(
  date: IsoDate,
  separator: '/' | '-' = '/',
): string {
  const [y, m, d] = date.split('-');
  return `${d}${separator}${m}${separator}${y}`;
}

/** Parses DD/MM/YYYY or DD-MM-YYYY (as returned by KRA) into an IsoDate; undefined when absent or malformed. */
export function parseDdMmYyyy(
  value: string | undefined | null,
): IsoDate | undefined {
  if (!value) return undefined;
  const m = /^(\d{2})[/-](\d{2})[/-](\d{4})/.exec(value.trim());
  if (!m) return undefined;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return isIsoDate(iso) ? iso : undefined;
}

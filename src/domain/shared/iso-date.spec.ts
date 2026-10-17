import {
  formatDdMmYyyy,
  isIsoDate,
  parseDdMmYyyy,
  toIsoDate,
} from './iso-date';

describe('IsoDate', () => {
  it('validates real calendar dates', () => {
    expect(isIsoDate('1990-01-15')).toBe(true);
    expect(isIsoDate('2023-02-29')).toBe(false);
    expect(isIsoDate('15/01/1990')).toBe(false);
    expect(isIsoDate(19900115)).toBe(false);
  });
  it('toIsoDate throws on invalid input', () => {
    expect(() => toIsoDate('nope')).toThrow(RangeError);
    expect(toIsoDate('2001-06-10')).toBe('2001-06-10');
  });
  it('formats DD/MM/YYYY with the requested separator', () => {
    expect(formatDdMmYyyy(toIsoDate('1955-08-16'))).toBe('16/08/1955');
    expect(formatDdMmYyyy(toIsoDate('1955-08-16'), '-')).toBe('16-08-1955');
  });
  it('parses KRA date strings with or without time', () => {
    expect(parseDdMmYyyy('16/08/1955')).toBe('1955-08-16');
    expect(parseDdMmYyyy('02/06/2023 17:15:24')).toBe('2023-06-02');
    expect(parseDdMmYyyy('01-01-1900')).toBe('1900-01-01');
    expect(parseDdMmYyyy('')).toBeUndefined();
    expect(parseDdMmYyyy('31/02/2020')).toBeUndefined();
  });
});

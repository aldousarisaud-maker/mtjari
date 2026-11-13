/**
 * Money is always handled as integer minor units (fils, halalas...).
 * Gulf currencies differ: KWD, BHD and OMR have 3 decimals; SAR, AED, QAR have 2.
 */
const DECIMALS: Record<string, number> = { KWD: 3, BHD: 3, OMR: 3, SAR: 2, AED: 2, QAR: 2, USD: 2 };

export const MAX_MONEY_MINOR = 2_000_000_000; // fits a 32-bit integer column

export function currencyDecimals(currency: string): number {
  const d = DECIMALS[currency];
  if (d === undefined) throw new Error(`Unsupported currency: ${currency}`);
  return d;
}

const ARABIC_DIGITS = /[٠-٩]/g;

/**
 * Parses a human-entered decimal ("12.5", "1,250.750", "١٢٫٥") into minor
 * units without floating-point arithmetic. Returns null when the text is not
 * a valid non-negative amount for the currency (e.g. too many decimals).
 */
export function toMinor(input: string | number, currency: string): number | null {
  const decimals = currencyDecimals(currency);
  let text = (typeof input === 'number' ? String(input) : input).trim();
  text = text.replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/٫/g, '.').replace(/[,٬\s]/g, '');
  const m = /^(\d+)(?:\.(\d*))?$/.exec(text);
  if (!m) return null;
  const frac = m[2] ?? '';
  if (frac.length > decimals) return null;
  const minor = Number(m[1]) * 10 ** decimals + Number((frac + '0'.repeat(decimals)).slice(0, decimals) || 0);
  return Number.isSafeInteger(minor) && minor <= MAX_MONEY_MINOR ? minor : null;
}

/** Plain decimal string for inputs and CSV, e.g. 12500 KWD-minor → "12.500". */
export function fromMinor(minor: number, currency: string): string {
  const decimals = currencyDecimals(currency);
  const s = String(Math.abs(Math.trunc(minor))).padStart(decimals + 1, '0');
  return `${minor < 0 ? '-' : ''}${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
}

export function formatMoney(minor: number, currency: string, locale: 'ar' | 'en' = 'ar'): string {
  const decimals = currencyDecimals(currency);
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-KW-u-nu-latn' : 'en-KW', {
    style: 'currency', currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).format(minor / 10 ** decimals);
}

/** Gross margin as a percentage of price (one decimal), or null when not computable. */
export function marginPercent(price: number, cost: number | null | undefined): number | null {
  if (cost == null || price <= 0) return null;
  return Math.round(((price - cost) / price) * 1000) / 10;
}

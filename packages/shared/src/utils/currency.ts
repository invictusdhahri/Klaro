/**
 * TND uses 3 decimals (millimes). Other currencies fall back to 2.
 */
const DECIMALS_BY_CURRENCY: Record<string, number> = {
  TND: 3,
  EUR: 2,
  USD: 2,
};

export function formatCurrency(
  amount: number,
  currency = 'TND',
  locale: 'en' | 'fr' | 'ar' = 'fr',
): string {
  const decimals = DECIMALS_BY_CURRENCY[currency] ?? 2;
  const localeTag = locale === 'ar' ? 'ar-TN' : locale === 'fr' ? 'fr-TN' : 'en-US';
  return new Intl.NumberFormat(localeTag, {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}

export function tndToMillimes(tnd: number): number {
  return Math.round(tnd * 1000);
}

export function millimesToTnd(millimes: number): number {
  return millimes / 1000;
}

import { Prisma } from "@/generated/prisma/client";

// FIN-01/02: money is decimal.js, never JS number. Amounts travel as strings in JSON.
export type Money = Prisma.Decimal;
export const D = (v: string | number | Prisma.Decimal | null | undefined) => new Prisma.Decimal(v ?? 0);
export const ZERO = D(0);

const decimals = (currency: string) => new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;

/** Half-up rounding to the currency's minor unit (TAX-04). */
export const round = (v: Money, currency: string) => v.toDecimalPlaces(decimals(currency), Prisma.Decimal.ROUND_HALF_UP);

export const sum = (values: Money[]) => values.reduce((a, b) => a.plus(b), ZERO);

/** TAX-04: tax for one line, rounded per line. `inclusive` means `base` already contains the tax. */
export function lineTax(base: Money, ratePercent: Money, inclusive: boolean, currency: string): Money {
  if (ratePercent.isZero() || base.isZero()) return round(ZERO, currency);
  const tax = inclusive ? base.times(ratePercent).dividedBy(ratePercent.plus(100)) : base.times(ratePercent).dividedBy(100);
  return round(tax, currency);
}

export const str = (v: Money) => v.toFixed(4);

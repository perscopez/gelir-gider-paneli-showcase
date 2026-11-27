export type Currency = "EUR" | "TRY";

export const toEur = (amount: number, cur: Currency, eurTry: number) => (cur === "EUR" ? amount : amount / eurTry);
export const toTry = (amount: number, cur: Currency, eurTry: number) => (cur === "TRY" ? amount : amount * eurTry);

export function fmt(amount: number, cur: Currency, locale: string) {
  return new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-GB", {
    style: "currency",
    currency: cur,
    maximumFractionDigits: 2,
  }).format(amount);
}

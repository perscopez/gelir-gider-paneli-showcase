import { toEur } from "@/lib/money";
import type { Currency } from "@/lib/money";

// Özelleştirilebilir bütçe/hedef/kategori yardımcıları (saf fonksiyonlar, test edilir).

export type BudgetRow = {
  id: string; category_id: string; monthly_limit_eur: number | string; currency?: string | null;
  alert_pct?: number | null; valid_from?: string | null; valid_to?: string | null; label?: string | null;
};

const lastDay = (key: string) => { const [y, m] = key.split("-").map(Number); return `${key}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`; };

// Bir ay için geçerli bütçeler: geçerlilik aralığı o ayla kesişenler; aynı kategoride birden çok varsa en yeni başlangıçlı kazanır.
export function activeBudgets<T extends BudgetRow>(rows: T[], monthKey: string): T[] {
  const first = `${monthKey}-01`, last = lastDay(monthKey);
  const best = new Map<string, T>();
  for (const b of rows) {
    if (b.valid_from && b.valid_from > last) continue;
    if (b.valid_to && b.valid_to < first) continue;
    const cur = best.get(b.category_id);
    if (!cur || (b.valid_from ?? "") > (cur.valid_from ?? "")) best.set(b.category_id, b);
  }
  return [...best.values()];
}

// Bütçe limiti her zaman EUR'a çevrilerek karşılaştırılır (harcamalar EUR'a çevrilmiş tutulur). `rate` = 1 EUR kaç TRY.
export const budgetLimitEur = (b: Pick<BudgetRow, "monthly_limit_eur" | "currency">, rate: number | null): number =>
  b.currency === "TRY" ? (rate ? toEur(Number(b.monthly_limit_eur), "TRY", rate) : 0) : Number(b.monthly_limit_eur);

export const budgetAlertPct = (b: Pick<BudgetRow, "alert_pct">) => b.alert_pct ?? 80;

// Hedef ilerlemesi: hesaba bağlıysa o hesabın bakiyesi (hedef para birimine çevrilmiş), değilse elle girilen tutar.
export function goalProgress(
  g: { target_eur: number | string; saved_eur: number | string; currency?: string | null; account_id?: string | null },
  accounts: { id: string; currency: string; balance: number }[], rate: number | null,
): { currency: Currency; target: number; saved: number; linked: boolean } {
  const cur = (g.currency === "TRY" ? "TRY" : "EUR") as Currency;
  const acc = g.account_id ? accounts.find((a) => a.id === g.account_id) : undefined;
  let saved = Number(g.saved_eur);
  if (acc) {
    if (acc.currency === cur) saved = acc.balance;
    else if (rate) saved = cur === "EUR" ? toEur(acc.balance, "TRY", rate) : acc.balance * rate;
  }
  return { currency: cur, target: Number(g.target_eur), saved: Math.max(0, saved), linked: !!acc };
}

// Yerleşik kategori önerisi (ör. "Market") kullanıcının kategorisine bağlanır: önce yerleşik anahtar, sonra ad. Yeniden adlandırma bunu bozmaz.
export function categoryIdByKey<T extends { id: string; name_tr: string; builtin_key?: string | null }>(cats: T[] | null | undefined, key: string | null): string | null {
  if (!key || !cats) return null;
  return (cats.find((c) => c.builtin_key === key) ?? cats.find((c) => c.name_tr === key))?.id ?? null;
}

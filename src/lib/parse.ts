import type { Currency } from "@/lib/money";

// "45 market", "12.5 eur kahve", "+1200 try freelance lale"  → tutar, para birimi, açıklama, hesap ipucu
export function parseQuick(text: string) {
  const m = text.trim().match(/^([+-]?)\s*(\d+(?:[.,]\d{1,2})?)\s*(.*)$/);
  if (!m) return null;
  const amount = Number(m[2].replace(",", "."));
  let rest = m[3];
  let currency: Currency | undefined;
  const cur = rest.match(/^(eur|euro|€|try|tl|₺)(?=\s|$)\s*/i); // \b € ve ₺ için çalışmaz (kelime karakteri değil)
  if (cur) {
    currency = /^(eur|euro|€)/i.test(cur[1]) ? "EUR" : "TRY";
    rest = rest.slice(cur[0].length);
  }
  const acc = rest.match(/@(\S+)/);
  if (acc) rest = rest.replace(acc[0], "").trim();
  return {
    kind: m[1] === "+" ? ("income" as const) : ("expense" as const),
    amount,
    currency,
    merchant: rest.trim() || undefined,
    accountHint: acc?.[1],
  };
}

// Apple Pay / Kısayollar "Tutar" değişkeni biçimli metin gelir: "€12,50", "12.50 EUR", "1.234,56 ₺", "₺1,234.50".
export function parseMoney(input: string | number): { amount: number; currency?: Currency } | null {
  if (typeof input === "number") return Number.isFinite(input) && input !== 0 ? { amount: Math.abs(input) } : null;
  const s = input.trim();
  let currency: Currency | undefined;
  if (/€|\beur(o)?\b/i.test(s)) currency = "EUR";
  else if (/₺|\btl\b|\btry\b/i.test(s)) currency = "TRY";
  const m = s.replace(/[^\d.,]/g, "");
  if (!/\d/.test(m)) return null;
  const dots = (m.match(/\./g) ?? []).length;
  const commas = (m.match(/,/g) ?? []).length;
  let norm = m;
  if (dots && commas) {
    const dec = m.lastIndexOf(".") > m.lastIndexOf(",") ? "." : ",";
    const thou = dec === "." ? "," : ".";
    norm = m.split(thou).join("").replace(dec, ".");
  } else if (dots || commas) {
    const sep = dots ? "." : ",";
    const count = dots || commas;
    const after = m.length - m.lastIndexOf(sep) - 1;
    // Para ≤ 2 ondalık basamaklıdır: tek ayraç + 3 hane ya da birden çok ayraç = binlik ayracı.
    norm = count > 1 || after === 3 ? m.split(sep).join("") : m.replace(sep, ".");
  }
  const amount = Number(norm);
  return Number.isFinite(amount) && amount > 0 ? { amount, currency } : null;
}

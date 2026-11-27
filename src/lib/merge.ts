import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysISO } from "@/lib/date";

// Aynı alışveriş iki yoldan gelirse (Apple Pay bildirimi + Telegram fişi) tek işlem kalsın diye eşleştirir.
export type MatchRow = { id: string; merchant: string | null; amount: number; currency: string; occurred_on: string; account_id: string; category_id: string | null; note: string | null };

const fold = (s: string) => s.toLowerCase().replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss").replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ç/g, "c");
const toks = (s: string) => fold(s).replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length >= 3 && !["sagt", "danke", "gmbh", "kg", "filiale", "markt", "und"].includes(w));

export function merchantsOverlap(a?: string | null, b?: string | null) {
  if (!a || !b) return false;
  const x = toks(a), y = toks(b);
  return x.some((t) => y.some((u) => t === u || (t.length >= 4 && u.length >= 4 && (t.startsWith(u) || u.startsWith(t)))));
}

const dayDiff = (a: string, b: string) => Math.abs(new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 864e5;

// mode "apple_pay": fişsiz Apple Pay işlemi arar (fiş geldi). mode "telegram": henüz birleşmemiş Telegram fiş işlemi arar (Apple Pay geldi).
export async function findMatch(
  db: SupabaseClient, uid: string, q: { amount: number; currency?: string | null; merchant?: string | null; date: string }, mode: "apple_pay" | "telegram",
): Promise<MatchRow | null> {
  // Apple Pay bildirimi alışveriş anında gelir: fiş zaten girilmişse en fazla ±1 gün; fiş sonradan geliyorsa (fotoğraf ertesi gün atılabilir) ±3 gün.
  const window = mode === "apple_pay" ? 3 : 1;
  let query = db.from("transactions").select("id,merchant,amount,currency,occurred_on,account_id,category_id,note")
    .eq("user_id", uid).eq("kind", "expense").gte("amount", q.amount - 0.011).lte("amount", q.amount + 0.011)
    .gte("occurred_on", addDaysISO(q.date, -window)).lte("occurred_on", addDaysISO(q.date, window)).order("created_at", { ascending: false }).limit(10);
  if (q.currency) query = query.eq("currency", q.currency);
  // "tg:" = hesap ipucusuz fiş (varsayılan nakit). "tgh:" = kullanıcı hesabı kendisi seçti (@nakit/@kart): asla taşınmaz/birleştirilmez.
  query = mode === "apple_pay" ? query.eq("source", "apple_pay").is("receipt_path", null) : query.eq("source", "telegram").like("external_id", "tg:%");
  const { data } = await query;
  const rows = (data ?? []) as MatchRow[];
  if (!rows.length) return null;
  // Yalnızca mağaza adı eşleşenler birleştirilir. Ad eşleşmiyorsa iki ayrı kayıt kalır (yanlış birleştirmeden daha güvenli; fazlalığı silmek kolay).
  const ranked = rows
    .map((r) => ({ r, overlap: merchantsOverlap(r.merchant, q.merchant), d: dayDiff(r.occurred_on, q.date) }))
    .filter((x) => x.overlap)
    .sort((a, b) => a.d - b.d);
  return ranked[0]?.r ?? null;
}

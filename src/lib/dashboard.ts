import { addMonthsKey, dueDateISO } from "@/lib/date";
import { toEur, type Currency } from "@/lib/money";

// Panel hesapları (saf fonksiyonlar, test edilebilir). Kurallar:
//  - Hesaplar arası transfer gelir/gider değildir. İstisna: bloke hesaptan harcanabilir hesaba aylık ödeme = gelir.
//  - Fabrikam bir sonraki ayın parasını ayın son günlerinde gönderir: ayın 25'inden sonra gelen ödeme sonraki aya sayılır.
export type TxnRow = {
  kind: string; amount: number | string; currency: string; eur_try_rate: number | string; occurred_on: string; category_id: string | null;
  category: { name_tr: string; name_en: string } | null; account: { type: string } | null; to_account: { type: string } | null;
};

export const PAYOUT_SHIFT_DAY = 25;

// "Ayrılmış" hesaplar: bloke ve nakit kenar. Buradan harcanabilir hesaba giden transfer gelirdir (para harcanabilir hale gelir).
const HELD = new Set(["blocked", "reserve"]);
const isRelease = (r: Pick<TxnRow, "kind" | "account" | "to_account">) =>
  r.kind === "transfer" && HELD.has(r.account?.type ?? "") && !HELD.has(r.to_account?.type ?? "");

export function effectiveKind(r: Pick<TxnRow, "kind" | "account" | "to_account">): "income" | "expense" | "transfer" {
  const isPayout = isRelease(r);
  if (r.kind === "transfer") return isPayout ? "income" : "transfer";
  return r.kind === "income" ? "income" : "expense";
}

export function effectiveMonth(r: Pick<TxnRow, "kind" | "account" | "to_account" | "occurred_on">): string {
  // 25'inden sonra kayma yalnızca Fabrikam bloke ödemesi için; nakit kenardan çekilen para hemen o ayın gelirdir.
  const isPayout = isRelease(r) && r.account?.type === "blocked";
  const ym = r.occurred_on.slice(0, 7);
  return isPayout && Number(r.occurred_on.slice(8, 10)) >= PAYOUT_SHIFT_DAY ? addMonthsKey(ym, 1) : ym;
}

export type Summary = {
  inc: number; exp: number; net: number;
  payout: number; // inc içinden: bloke hesaptan harcanabilir hesaba geçen aylık ödeme (dışarıdan gelen gelir = inc − payout)
  monthly: { key: string; inc: number; exp: number }[]; // son 6 ay, eskiden yeniye
  byCat: Map<string, { name: string; value: number }>; // bu ayın giderleri (kategori kimliği → ad/tutar)
  spentById: Map<string, number>; // kategori kimliği → bu ayki gider (bütçeler için)
};

export function summarize(rows: TxnRow[], currentKey: string, opts: { locale: "tr" | "en"; uncategorized: string }): Summary {
  const monthly = new Map<string, { inc: number; exp: number }>();
  for (let i = 5; i >= 0; i--) monthly.set(addMonthsKey(currentKey, -i), { inc: 0, exp: 0 });
  const byCat = new Map<string, { name: string; value: number }>();
  const spentById = new Map<string, number>();
  let inc = 0, exp = 0, payout = 0;
  for (const r of rows) {
    const kind = effectiveKind(r);
    if (kind === "transfer") continue;
    const key = effectiveMonth(r);
    const eur = toEur(Number(r.amount), r.currency as Currency, Number(r.eur_try_rate));
    const bucket = monthly.get(key);
    if (bucket) { if (kind === "income") bucket.inc += eur; else bucket.exp += eur; }
    if (key !== currentKey) continue;
    if (kind === "income") {
      inc += eur;
      if (r.kind === "transfer") payout += eur;
      continue;
    }
    exp += eur;
    const c = r.category;
    const name = c ? (opts.locale === "tr" ? c.name_tr : c.name_en) : opts.uncategorized;
    const id = r.category_id ?? "none";
    byCat.set(id, { name, value: (byCat.get(id)?.value ?? 0) + eur });
    if (r.category_id) spentById.set(r.category_id, (spentById.get(r.category_id) ?? 0) + eur);
  }
  return { inc, exp, net: inc - exp, payout, monthly: [...monthly.entries()].map(([key, v]) => ({ key, ...v })), byCat, spentById };
}

const MS_DAY = 864e5;
const dayDiff = (a: string, b: string) => Math.round((new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / MS_DAY);

// Bu ayın kalan (henüz oluşmamış) sabit giderleri: vadesi bugün ya da ay sonuna kadar olan, aktif, tarih aralığına uyan ve cron'un henüz yazmadığı gider kuralları.
// Gelir kuralları eklenmez: Fabrikam ödemesi gibi ayın 25'inden sonraki gelir zaten sonraki aya sayılır, ayrıca tahmini gelire güvenmek iyimser olur.
export type RuleRow = { name: string; kind: string; amount: number | string; currency: string; day_of_month: number; start_date?: string | null; end_date?: string | null; last_run_on?: string | null };

function dueRules(rules: RuleRow[], today: string) {
  const key = today.slice(0, 7);
  return rules.flatMap((r) => {
    if (r.kind !== "expense") return [];
    const due = dueDateISO(key, r.day_of_month);
    if (due < today) return [];
    if (r.start_date && due < r.start_date) return [];
    if (r.end_date && due > r.end_date) return [];
    if (r.last_run_on && due <= r.last_run_on) return []; // cron bu vadeyi zaten yazdı: giderlere dahil
    return [{ name: r.name, due, amount: Number(r.amount), currency: r.currency as Currency }];
  });
}

export function remainingFixedExpenses(rules: RuleRow[], today: string, eurTry: number) {
  const items = dueRules(rules, today).flatMap((r) => (r.currency === "TRY" && !(eurTry > 0) ? [] : [{ name: r.name, due: r.due, eur: toEur(r.amount, r.currency, eurTry) }])); // kur yoksa TL kuralı çevrilemez
  return { total: items.reduce((a, i) => a + i.eur, 0), items };
}

// Para birimine göre (çevirmeden): kalan sabit giderler. Cüzdan kartlarındaki günlük pay için.
export function remainingFixedByCurrency(rules: RuleRow[], today: string): Record<Currency, { total: number; items: { name: string; due: string; amount: number }[] }> {
  const out: Record<Currency, { total: number; items: { name: string; due: string; amount: number }[] }> = { EUR: { total: 0, items: [] }, TRY: { total: 0, items: [] } };
  for (const r of dueRules(rules, today)) {
    out[r.currency].items.push({ name: r.name, due: r.due, amount: r.amount });
    out[r.currency].total += r.amount;
  }
  return out;
}

// Para birimine göre ay toplamları (kur çevirisi yok): cüzdan kartları. Kurallar summarize ile aynı (transfer hariç, bloke ödemesi gelir, 25'inden sonra sonraki ay).
export type CurrencyTotals = { inc: number; exp: number; payout: number; net: number };
export function totalsByCurrency(rows: TxnRow[], monthKey: string): Record<Currency, CurrencyTotals> {
  const out: Record<Currency, CurrencyTotals> = { EUR: { inc: 0, exp: 0, payout: 0, net: 0 }, TRY: { inc: 0, exp: 0, payout: 0, net: 0 } };
  for (const r of rows) {
    const cur = r.currency as Currency;
    if (!out[cur]) continue;
    const kind = effectiveKind(r);
    if (kind === "transfer" || effectiveMonth(r) !== monthKey) continue;
    const amt = Number(r.amount);
    if (kind === "income") { out[cur].inc += amt; if (r.kind === "transfer") out[cur].payout += amt; }
    else out[cur].exp += amt;
  }
  for (const c of ["EUR", "TRY"] as Currency[]) out[c].net = out[c].inc - out[c].exp;
  return out;
}

// Hesap bakiyeleri para birimine göre: harcanabilir (bloke hariç) ve bloke.
export function walletBalances(accounts: { currency: string; type: string; balance: number }[], cur: Currency) {
  const mine = accounts.filter((a) => a.currency === cur);
  const blocked = mine.filter((a) => a.type === "blocked").reduce((s, a) => s + a.balance, 0);
  const reserve = mine.filter((a) => a.type === "reserve").reduce((s, a) => s + a.balance, 0);
  return { count: mine.length, blocked, reserve, spendable: mine.reduce((s, a) => s + a.balance, 0) - blocked - reserve };
}

// Ay sonuna kadar günlük harcanabilir tutar: (net − kalan sabit giderler) artıdaysa kalan günlere (bugün dahil) bölünür.
export function dailyAllowance(net: number, today: string, spentThisMonth: number, committed = 0) {
  const lastDay = dueDateISO(today.slice(0, 7), 31);
  const daysLeft = Math.max(1, dayDiff(lastDay, today) + 1);
  const daysPassed = Math.max(1, Number(today.slice(8, 10)));
  const free = net - committed;
  return { daysLeft, free, committed, perDay: free > 0 ? free / daysLeft : 0, avgSoFar: spentThisMonth / daysPassed };
}

// Yaklaşan tekrarlayan ödemeler: vadesi bugünden itibaren `windowDays` içinde olanlar.
export function upcomingRules<T extends { day_of_month: number; end_date: string | null }>(rules: T[], today: string, windowDays = 14) {
  const horizon = new Date(`${today}T00:00:00Z`).getTime() + windowDays * MS_DAY;
  return rules.flatMap((r) => {
    const thisM = dueDateISO(today.slice(0, 7), r.day_of_month);
    const due = thisM >= today ? thisM : dueDateISO(addMonthsKey(today.slice(0, 7), 1), r.day_of_month);
    if (new Date(`${due}T00:00:00Z`).getTime() > horizon || (r.end_date && due > r.end_date)) return [];
    return [{ ...r, due, days: dayDiff(due, today) }];
  }).sort((a, b) => a.days - b.days);
}

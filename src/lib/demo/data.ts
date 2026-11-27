// Gösterim modu için uydurma veri seti: gerçek veriye hiç dokunmaz. Tarihler bugüne göre üretilir, bu yüzden hep güncel görünür.
import { addDaysISO, addMonthsKey, monthKey, todayISO } from "@/lib/date";

type Row = Record<string, unknown> & { id: string };
const UID = "demo-user";

// Deterministik sözde-rastgele: her yenilemede aynı sayılar çıkar.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

export type DemoDb = Record<string, Row[]>;

function buildItems(today: string): Row[] {
  // [ürün, kategori, mağaza, €/birim, birim, kaç gün önce]
  const defs: [string, string, string, number, string, number][] = [
    ["Vollmilch", "Süt, Yumurta & Peynir", "Supermarkt Nord", 1.29, "l", 3], ["Vollmilch", "Süt, Yumurta & Peynir", "Bio Markt", 1.89, "l", 10],
    ["Eier", "Süt, Yumurta & Peynir", "Supermarkt Nord", 0.31, "pcs", 3], ["Eier", "Süt, Yumurta & Peynir", "Bio Markt", 0.49, "pcs", 17],
    ["Bananen", "Meyve & Sebze", "Supermarkt Nord", 1.69, "kg", 5], ["Bananen", "Meyve & Sebze", "Bio Markt", 2.29, "kg", 12],
    ["Nudeln", "Kuru Gıda & Bakliyat", "Supermarkt Nord", 1.8, "kg", 8], ["Hähnchenbrust", "Et, Tavuk & Balık", "Bio Markt", 11.9, "kg", 9],
    ["Hähnchenbrust", "Et, Tavuk & Balık", "Supermarkt Nord", 8.9, "kg", 20], ["Brot", "Ekmek & Fırın", "Supermarkt Nord", 3.2, "kg", 4],
  ];
  return defs.map(([product, category, merchant, ppb, unit, ago], i) => ({
    id: `ri-${i}`, user_id: "demo-user", transaction_id: `t-${i + 1}`, line_no: i, name: product.toUpperCase(), product, category, merchant,
    quantity: unit === "pcs" ? 6 : 1, unit, unit_price: ppb, brand: null, pack_amount: null, pack_unit: null,
    line_total: Math.round(ppb * (unit === "pcs" ? 6 : 1) * 100) / 100, base_unit: unit, price_per_base: ppb, purchased_on: addDaysISO(today, -ago), currency: "EUR",
  }));
}

export function buildDemoDb(): DemoDb {
  const rnd = rng(42);
  const today = todayISO();
  const rate = 36.4; // uydurma kur
  const mk = (id: string, o: Record<string, unknown>): Row => ({ id, user_id: UID, created_at: `${today}T08:00:00Z`, ...o });

  const catDefs: [string, string, string, "income" | "expense"][] = [
    ["c-sal", "Maaş", "Salary", "income"], ["c-fre", "Freelance / iş", "Freelance / work", "income"], ["c-fam", "Aile desteği", "Family support", "income"],
    ["c-rent", "Kira", "Rent", "expense"], ["c-groc", "Market", "Groceries", "expense"], ["c-eat", "Dışarıda yemek", "Eating out", "expense"],
    ["c-trans", "Ulaşım", "Transport", "expense"], ["c-bill", "Faturalar", "Bills", "expense"], ["c-subs", "Abonelikler", "Subscriptions", "expense"],
    ["c-health", "Sağlık", "Health", "expense"], ["c-shop", "Alışveriş", "Shopping", "expense"], ["c-fun", "Eğlence", "Entertainment", "expense"],
  ];
  const categories = catDefs.map(([id, name_tr, name_en, kind]) => mk(id, { name_tr, name_en, kind, icon: null }));

  const accounts = [
    mk("a-main", { name: "Ana Hesap", institution: "Demo Bank", type: "bank", currency: "EUR", opening_balance: 1200, archived: false, sort_order: 0 }),
    mk("a-cash", { name: "Nakit", institution: null, type: "cash", currency: "EUR", opening_balance: 150, archived: false, sort_order: 1 }),
    mk("a-save", { name: "Birikim", institution: "Demo Bank", type: "bank", currency: "EUR", opening_balance: 4800, archived: false, sort_order: 2 }),
    mk("a-try", { name: "Vadesiz TL", institution: "Demo TR", type: "bank", currency: "TRY", opening_balance: 52000, archived: false, sort_order: 3 }),
    mk("a-card", { name: "Kredi Kartı", institution: "Demo TR", type: "credit_card", currency: "TRY", opening_balance: -4300, credit_limit: 40000, due_day: 18, statement_day: 8, archived: false, sort_order: 4 }),
    mk("a-block", { name: "Bloke Hesap", institution: "Demo Bloke", type: "blocked", currency: "EUR", opening_balance: 9000, blocked_end_date: addDaysISO(today, 330), archived: false, sort_order: 5 }),
  ];

  const transactions: Row[] = [];
  let n = 0;
  const tx = (account_id: string, kind: string, amount: number, currency: string, occurred_on: string, merchant: string, cat?: string, extra: Record<string, unknown> = {}) => {
    transactions.push(mk(`t-${++n}`, {
      account_id, kind, amount: Math.round(amount * 100) / 100, currency, eur_try_rate: rate, occurred_on, merchant, category_id: cat ?? null,
      note: null, receipt_path: null, to_account_id: null, to_amount: null, source: "manual", external_id: null, tags: [], ...extra,
    }));
  };

  const shops: [string, string, number, number][] = [
    ["Supermarkt Nord", "c-groc", 6, 55], ["Bio Markt", "c-groc", 8, 40], ["Kaffee & Co", "c-eat", 3, 9], ["Pizza Roma", "c-eat", 9, 28],
    ["City Bahn", "c-trans", 3, 20], ["Online Shop", "c-shop", 10, 90], ["Kino Center", "c-fun", 8, 25], ["Apotheke", "c-health", 5, 30],
  ];
  const nowKey = monthKey();
  for (let back = 5; back >= 0; back--) {
    const key = addMonthsKey(nowKey, -back);
    const day = (d: number) => `${key}-${String(d).padStart(2, "0")}`;
    const upto = back === 0 ? Number(today.slice(8, 10)) : 28;
    const ok = (d: number) => d <= upto && day(d) <= today;
    if (ok(1)) tx("a-main", "income", 2450 + Math.round(rnd() * 120), "EUR", day(1), "Acme GmbH", "c-sal");
    if (ok(3)) tx("a-main", "expense", 780, "EUR", day(3), "Hausverwaltung", "c-rent");
    if (ok(5)) tx("a-main", "expense", 42, "EUR", day(5), "Stadtwerke", "c-bill");
    if (ok(9)) tx("a-main", "expense", 11.99, "EUR", day(9), "Streamflix", "c-subs");
    if (ok(10)) tx("a-main", "transfer", 300, "EUR", day(10), "Birikime aktarım", undefined, { to_account_id: "a-save", to_amount: 300 });
    if (ok(14) && rnd() > 0.4) tx("a-main", "income", 200 + Math.round(rnd() * 300), "EUR", day(14), "Freelance proje", "c-fre");
    if (ok(20)) tx("a-cash", "income", 120, "EUR", day(20), "Nakit çekim", "c-fam");
    for (let d = 2; d <= upto; d += 2) {
      if (day(d) > today) break;
      const [m, c, lo, hi] = shops[Math.floor(rnd() * shops.length)];
      tx(rnd() > 0.3 ? "a-main" : "a-cash", "expense", lo + rnd() * (hi - lo), "EUR", day(d), m, c);
    }
    if (ok(12)) tx("a-try", "expense", 900 + Math.round(rnd() * 1500), "TRY", day(12), "Yerel Market", "c-groc");
    if (ok(15)) tx("a-card", "expense", 600 + Math.round(rnd() * 900), "TRY", day(15), "Online Alışveriş", "c-shop");
  }
  // Son iki gün yakın tarihli birkaç satır: listenin tepesi canlı görünsün.
  tx("a-main", "expense", 4.2, "EUR", today, "Kaffee & Co", "c-eat");
  tx("a-main", "expense", 23.8, "EUR", addDaysISO(today, -1), "Supermarkt Nord", "c-groc");

  const budgets = [["c-groc", 280], ["c-eat", 120], ["c-shop", 150], ["c-fun", 60]].map(([category_id, monthly_limit_eur], i) => mk(`b-${i}`, { category_id, monthly_limit_eur }));
  const goals = [
    mk("g-1", { name: "Yaz tatili", target_eur: 2000, saved_eur: 850, target_date: addDaysISO(today, 200) }),
    mk("g-2", { name: "Yeni laptop", target_eur: 1500, saved_eur: 1320, target_date: null }),
  ];
  const recurring_rules = [
    mk("r-1", { name: "Kira", account_id: "a-main", category_id: "c-rent", kind: "expense", amount: 780, currency: "EUR", day_of_month: 3, auto_create: true, remind_days_before: 2, start_date: "2026-01-01", end_date: null, active: true }),
    mk("r-2", { name: "Streamflix", account_id: "a-main", category_id: "c-subs", kind: "expense", amount: 11.99, currency: "EUR", day_of_month: 9, auto_create: true, remind_days_before: 1, start_date: "2026-01-01", end_date: null, active: true }),
    mk("r-3", { name: "Maaş", account_id: "a-main", category_id: "c-sal", kind: "income", amount: 2500, currency: "EUR", day_of_month: 1, auto_create: false, remind_days_before: 0, start_date: "2026-01-01", end_date: null, active: true }),
  ];
  const category_rules = [mk("cr-1", { pattern: "supermarkt", category_id: "c-groc" }), mk("cr-2", { pattern: "kaffee", category_id: "c-eat" })];

  return {
    accounts, categories, transactions, budgets, goals, recurring_rules, category_rules, receipt_items: buildItems(today), user_settings: [],
    fx_rates: [{ id: "fx-1", day: today, eur_try: rate }],
  };
}

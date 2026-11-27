import { describe, expect, it } from "vitest";
import { dailyAllowance, effectiveKind, effectiveMonth, summarize, upcomingRules, type TxnRow } from "@/lib/dashboard";

const row = (o: Partial<TxnRow>): TxnRow => ({
  kind: "expense", amount: 10, currency: "EUR", eur_try_rate: 50, occurred_on: "2026-11-05", category_id: null, category: null, account: { type: "bank" }, to_account: null, ...o,
});
const payout = (day: string, amount = 1000): TxnRow => row({ kind: "transfer", amount, occurred_on: day, account: { type: "blocked" }, to_account: { type: "bank" } });
const opts = { locale: "tr" as const, uncategorized: "Kategorisiz" };

describe("efektif tür ve ay", () => {
  it("bloke → harcanabilir transfer = gelir; diğer transferler sayılmaz", () => {
    expect(effectiveKind(payout("2026-11-02"))).toBe("income");
    expect(effectiveKind(row({ kind: "transfer", account: { type: "bank" }, to_account: { type: "cash" } }))).toBe("transfer");
    expect(effectiveKind(row({ kind: "transfer", account: { type: "blocked" }, to_account: { type: "blocked" } }))).toBe("transfer");
  });
  it("ayın 25'inden sonra gelen bloke ödemesi sonraki aya kayar", () => {
    expect(effectiveMonth(payout("2026-10-31"))).toBe("2026-11");
    expect(effectiveMonth(payout("2026-10-25"))).toBe("2026-11");
    expect(effectiveMonth(payout("2026-10-24"))).toBe("2026-10");
    expect(effectiveMonth(payout("2026-12-30"))).toBe("2027-01"); // yıl geçişi
  });
  it("nakit kenardan harcanabilir hesaba transfer = gelir, ay kayması yok", () => {
    const fromReserve = row({ kind: "transfer", amount: 460, occurred_on: "2026-12-30", account: { type: "reserve" }, to_account: { type: "cash" } });
    expect(effectiveKind(fromReserve)).toBe("income");
    expect(effectiveMonth(fromReserve)).toBe("2026-12"); // 25'inden sonra da o ayın geliri
    expect(effectiveKind(row({ kind: "transfer", account: { type: "cash" }, to_account: { type: "reserve" } }))).toBe("transfer"); // kenara ayırmak gelir/gider değil
  });
  it("normal işlem ayını korur (25'inden sonra da)", () => expect(effectiveMonth(row({ occurred_on: "2026-10-31" }))).toBe("2026-10"));
});

describe("summarize", () => {
  it("31 Ekim bloke ödemesi Kasım gelirine yazılır, Ekim'e değil", () => {
    const s = summarize([payout("2026-10-31"), row({ amount: 100, occurred_on: "2026-11-03" })], "2026-11", opts);
    expect(s.inc).toBe(1000);
    expect(s.exp).toBe(100);
    expect(s.net).toBe(900);
    expect(s.monthly.find((m) => m.key === "2026-10")?.inc).toBe(0);
  });
  it("TRY, kurla EUR'a çevrilir", () => expect(summarize([row({ amount: 500, currency: "TRY", eur_try_rate: 50 })], "2026-11", opts).exp).toBe(10));
  it("transferler gelir/gider dışı", () => expect(summarize([row({ kind: "transfer", to_account: { type: "cash" } })], "2026-11", opts)).toMatchObject({ inc: 0, exp: 0 }));
  it("kategori kırılımı ve bütçe harcaması", () => {
    const food = { name_tr: "Market", name_en: "Groceries" };
    const s = summarize([row({ amount: 30, category_id: "c1", category: food }), row({ amount: 20, category_id: "c1", category: food }), row({ amount: 5 })], "2026-11", opts);
    expect(s.byCat.get("c1")).toEqual({ name: "Market", value: 50 });
    expect(s.byCat.get("none")).toEqual({ name: "Kategorisiz", value: 5 });
    expect(s.spentById.get("c1")).toBe(50);
    expect(s.spentById.has("none")).toBe(false);
  });
  it("6 aylık seri eskiden yeniye ve geçmiş ay bu aya sayılmaz", () => {
    const s = summarize([row({ amount: 40, occurred_on: "2026-09-10" })], "2026-11", opts);
    expect(s.monthly.map((m) => m.key)).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
    expect(s.monthly.find((m) => m.key === "2026-09")?.exp).toBe(40);
    expect(s.exp).toBe(0);
  });
});

describe("dailyAllowance", () => {
  it("net / kalan gün (bugün dahil)", () => {
    const a = dailyAllowance(720, "2026-11-15", 870);
    expect(a.daysLeft).toBe(16);
    expect(a.perDay).toBe(45);
    expect(a.avgSoFar).toBe(58);
  });
  it("net eksideyse pay 0", () => expect(dailyAllowance(-50, "2026-11-15", 100).perDay).toBe(0));
  it("ayın son günü: 1 gün kalır", () => expect(dailyAllowance(30, "2026-11-30", 0).daysLeft).toBe(1));
  it("şubat (artık yıl değil)", () => expect(dailyAllowance(28, "2027-02-01", 0).daysLeft).toBe(28));
});

describe("upcomingRules", () => {
  const r = (d: number, end: string | null = null) => ({ day_of_month: d, end_date: end });
  it("14 gün içindekiler, vade sırasıyla", () => {
    const u = upcomingRules([r(25), r(18), r(3)], "2026-11-15");
    expect(u.map((x) => x.due)).toEqual(["2026-11-18", "2026-11-25"]);
    expect(u.map((x) => x.days)).toEqual([3, 10]);
  });
  it("geçmiş gün sonraki aya taşınır (ay sonu kırpma dahil)", () => expect(upcomingRules([r(31)], "2026-02-20", 14)[0]?.due).toBe("2026-02-28"));
  it("bitiş tarihini geçen kural gösterilmez", () => expect(upcomingRules([r(18, "2026-11-10")], "2026-11-15")).toEqual([]));
});

import { remainingFixedExpenses } from "@/lib/dashboard";

describe("remainingFixedExpenses", () => {
  const rule = (o: Record<string, unknown> = {}) => ({ name: "Kira", kind: "expense", amount: 800, currency: "EUR", day_of_month: 20, start_date: "2026-01-01", end_date: null, last_run_on: null, ...o });
  it("ay sonuna kadar vadesi gelecek gider kuralları toplanır", () => {
    const r = remainingFixedExpenses([rule(), rule({ name: "Spotify", amount: 10, day_of_month: 30 })], "2026-11-15", 50);
    expect(r.total).toBe(810);
    expect(r.items.map((i) => i.name)).toEqual(["Kira", "Spotify"]);
  });
  it("vadesi geçmiş, gelir, başlamamış, bitmiş kurallar dahil edilmez", () => {
    const rules = [rule({ day_of_month: 4 }), rule({ kind: "income" }), rule({ start_date: "2026-12-01" }), rule({ end_date: "2026-11-10" })];
    expect(remainingFixedExpenses(rules, "2026-11-15", 50).total).toBe(0);
  });
  it("cron bu vadeyi zaten yazdıysa (last_run_on) sayılmaz; bugün vadesi olan sayılır", () => {
    expect(remainingFixedExpenses([rule({ day_of_month: 15, last_run_on: "2026-11-15" })], "2026-11-15", 50).total).toBe(0);
    expect(remainingFixedExpenses([rule({ day_of_month: 15 })], "2026-11-15", 50).total).toBe(800);
  });
  it("TL kuralı kurla çevrilir, kur yoksa atlanır", () => {
    expect(remainingFixedExpenses([rule({ currency: "TRY", amount: 500 })], "2026-11-15", 50).total).toBe(10);
    expect(remainingFixedExpenses([rule({ currency: "TRY", amount: 500 })], "2026-11-15", 0).total).toBe(0);
  });
  it("31'inde vadeli kural kısa ayda ay sonuna düşer", () => expect(remainingFixedExpenses([rule({ day_of_month: 31 })], "2026-11-15", 50).items[0]?.due).toBe("2026-11-30"));
});

describe("dailyAllowance: sabit giderler düşülür", () => {
  it("net 720, kalan sabit gider 240, 16 gün → günde 30", () => {
    const a = dailyAllowance(720, "2026-11-15", 870, 240);
    expect(a.free).toBe(480);
    expect(a.perDay).toBe(30);
  });
  it("net artı ama sabit giderler onu aşarsa pay 0", () => expect(dailyAllowance(100, "2026-11-15", 0, 800).perDay).toBe(0));
});

describe("summarize: bloke ödemesi ayrı izlenir", () => {
  it("payout = gelirin bloke kaynaklı kısmı; dışarıdan gelir = inc − payout", () => {
    const s = summarize([payout("2026-10-31"), row({ kind: "income", amount: 300, occurred_on: "2026-11-03" })], "2026-11", opts);
    expect(s.inc).toBe(1300);
    expect(s.payout).toBe(1000);
    expect(s.inc - s.payout).toBe(300);
  });
  it("bloke ödemesi yoksa payout 0", () => expect(summarize([row({ kind: "income", amount: 10 })], "2026-11", opts).payout).toBe(0));
});

import { remainingFixedByCurrency, totalsByCurrency, walletBalances } from "@/lib/dashboard";

describe("cüzdanlar: para birimine göre ayrı hesap", () => {
  it("EUR ve TRY toplamları birbirine karışmaz (çeviri yok)", () => {
    const rows = [
      row({ kind: "income", amount: 2500, currency: "EUR" }), row({ amount: 100, currency: "EUR" }),
      row({ kind: "income", amount: 20000, currency: "TRY" }), row({ amount: 5000, currency: "TRY" }),
    ];
    const t = totalsByCurrency(rows, "2026-11");
    expect(t.EUR).toMatchObject({ inc: 2500, exp: 100, net: 2400 });
    expect(t.TRY).toMatchObject({ inc: 20000, exp: 5000, net: 15000 });
  });
  it("bloke ödemesi EUR gelirine yazılır, payout ayrıca izlenir; ay kayması geçerli", () => {
    const t = totalsByCurrency([payout("2026-10-31")], "2026-11");
    expect(t.EUR).toMatchObject({ inc: 1000, payout: 1000 });
    expect(t.TRY.inc).toBe(0);
    expect(totalsByCurrency([payout("2026-10-31")], "2026-10").EUR.inc).toBe(0);
  });
  it("transferler sayılmaz", () => expect(totalsByCurrency([row({ kind: "transfer", currency: "TRY", to_account: { type: "cash" } })], "2026-11").TRY).toMatchObject({ inc: 0, exp: 0 }));
  it("kalan sabit giderler para birimine göre toplanır", () => {
    const rule = (o: Record<string, unknown>) => ({ name: "k", kind: "expense", amount: 100, currency: "EUR", day_of_month: 20, start_date: "2026-01-01", end_date: null, last_run_on: null, ...o });
    const r = remainingFixedByCurrency([rule({}), rule({ currency: "TRY", amount: 500 }), rule({ amount: 40, day_of_month: 28 })], "2026-11-15");
    expect(r.EUR.total).toBe(140);
    expect(r.TRY.total).toBe(500);
  });
  it("bakiyeler: harcanabilir bloke hariç, para birimine göre", () => {
    const accs = [{ currency: "EUR", type: "bank", balance: 1000 }, { currency: "EUR", type: "blocked", balance: 9000 }, { currency: "TRY", type: "bank", balance: 50000 }];
    expect(walletBalances(accs, "EUR")).toEqual({ count: 2, blocked: 9000, reserve: 0, spendable: 1000 });
    expect(walletBalances(accs, "TRY")).toEqual({ count: 1, blocked: 0, reserve: 0, spendable: 50000 });
    const withReserve = [...accs, { currency: "EUR", type: "reserve", balance: 920 }];
    expect(walletBalances(withReserve, "EUR")).toEqual({ count: 3, blocked: 9000, reserve: 920, spendable: 1000 }); // nakit kenar harcanabilire sayılmaz
  });
});

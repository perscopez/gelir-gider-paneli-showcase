import { describe, expect, it } from "vitest";
import { fetchAll } from "@/lib/paginate";
import { balanceFrom } from "@/lib/balance";

// Sunucu gibi davranan sahte kaynak: her istekte en çok 1.000 satır verir.
const source = (n: number) => {
  const all = Array.from({ length: n }, (_, i) => ({ id: i }));
  let calls = 0;
  return { calls: () => calls, build: (from: number, to: number) => { calls++; return Promise.resolve({ data: all.slice(from, Math.min(to, from + 999) + 1), error: null }); } };
};

describe("fetchAll", () => {
  it("1.000'i aşan listeyi eksiksiz çeker", async () => {
    const s = source(2500);
    const rows = await fetchAll<{ id: number }>(s.build);
    expect(rows).toHaveLength(2500);
    expect(rows.at(-1)?.id).toBe(2499);
    expect(s.calls()).toBe(3);
  });
  it("tam sayfa sınırında fazladan boş sayfa ister ve durur", async () => {
    const s = source(2000);
    expect(await fetchAll(s.build)).toHaveLength(2000);
    expect(s.calls()).toBe(3);
  });
  it("küçük liste tek istek", async () => {
    const s = source(5);
    expect(await fetchAll(s.build)).toHaveLength(5);
    expect(s.calls()).toBe(1);
  });
  it("boş sonuç", async () => expect(await fetchAll(source(0).build)).toEqual([]));
  it("hata fırlatılır (sessiz eksik veri yok)", async () => {
    await expect(fetchAll(() => Promise.resolve({ data: null, error: { message: "boom" } }))).rejects.toThrow("boom");
  });
  it("üst sınır (max) korur", async () => expect(await fetchAll(source(5000).build, { max: 2000 })).toHaveLength(2000));
});

describe("balanceFrom", () => {
  const r = (o: Record<string, unknown>) => ({ kind: "expense", amount: 0, to_amount: null, account_id: "a", to_account_id: null, ...o }) as never;
  it("açılış + gelir − gider", () => expect(balanceFrom(100, "a", [r({ kind: "income", amount: 50 }), r({ amount: 30.5 })])).toBe(119.5));
  it("giden transfer düşer, gelen transfer eklenir (to_amount)", () => {
    expect(balanceFrom(0, "a", [r({ kind: "transfer", amount: 40, to_account_id: "b", to_amount: 40 })])).toBe(-40);
    expect(balanceFrom(0, "b", [r({ kind: "transfer", amount: 40, to_account_id: "b", to_amount: 38 })])).toBe(38);
  });
  it("başka hesabın işlemi etkilemez", () => expect(balanceFrom(10, "a", [r({ account_id: "z", amount: 99 })])).toBe(10));
});

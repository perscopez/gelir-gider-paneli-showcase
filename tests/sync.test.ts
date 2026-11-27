import { describe, expect, it } from "vitest";
import { syncOpeningToStatement } from "@/lib/statements/sync";

// Küçük sahte veritabanı: yalnızca sync'in kullandığı iki sorguyu karşılar.
const audit: Record<string, unknown>[] = [];
function fakeDb(opening: number, txns: Record<string, unknown>[], newer = 0) {
  const state = { opening };
  const db = {
    from(table: string) {
      if (table === "balance_adjustments") return { insert: async (row: Record<string, unknown>) => { audit.push(row); return {}; } };
      if (table === "accounts") {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { opening_balance: state.opening, user_id: "u1" } }) }) }), update: (v: { opening_balance: number }) => ({ eq: async () => { state.opening = v.opening_balance; return {}; } }) };
      }
      const q: { or: () => typeof q; lte: (_c: string, v: string) => typeof q; order: () => typeof q; range: () => Promise<{ data: unknown[]; error: null }> } = {
        or: () => q, order: () => q, lte: (_c, v) => { asOf = v; return q; },
        range: async () => ({ data: txns.filter((t) => String(t.occurred_on) <= asOf), error: null }),
      };
      let asOf = "9999-12-31";
      const count = { or: () => count, like: () => count, gt: async () => ({ count: newer }) };
      return { select: (cols: string) => (cols === "id" ? count : q) };
    },
  };
  return { db: db as never, state };
}

describe("syncOpeningToStatement", () => {
  const acc = "card";
  const t = (kind: string, amount: number, occurred_on: string, external_id: string | null) => ({ kind, amount, to_amount: null, account_id: acc, to_account_id: null, occurred_on, external_id });
  it("kesim gününde sonraki ekstrenin satırını saymaz", async () => {
    // Ekstre (kesim 02.10): borç 100. Panelde 100 harcama (01.10) + 02.10'da sonraki ekstreden gelen 50.
    const { db, state } = fakeDb(0, [t("expense", 100, "2026-10-01", "vk:a"), t("expense", 50, "2026-10-02", "vk:later")]);
    const { delta } = await syncOpeningToStatement(db, acc, "2026-10-02", -100, new Set(["vk:a"]), "vk:");
    expect(delta).toBe(0);
    expect(state.opening).toBe(0);
  });
  it("tutmuyorsa açılış bakiyesini farkla düzeltir", async () => {
    const { db, state } = fakeDb(0, [t("expense", 100, "2026-10-01", "vk:a")]);
    const { delta } = await syncOpeningToStatement(db, acc, "2026-10-02", -130, new Set(["vk:a"]), "vk:");
    expect(delta).toBe(-30);
    expect(state.opening).toBe(-30);
    expect(audit.at(-1)).toMatchObject({ account_id: acc, as_of: "2026-10-02", statement_balance: -130, old_opening: 0, new_opening: -30, delta: -30 }); // denetim izi yazıldı
  });
  it("daha yeni bir ekstrenin kaydı varsa eşitlemeyi atlar", async () => {
    const { db, state } = fakeDb(0, [t("expense", 100, "2026-10-01", "vk:a")], 2);
    const r = await syncOpeningToStatement(db, acc, "2026-10-02", -999, new Set(["vk:a"]), "vk:");
    expect(r).toMatchObject({ delta: 0, skipped: true });
    expect(state.opening).toBe(0);
  });
  it("kesim gününde başka yoldan girilmiş (ekstre kimliksiz) kayıt sayılır", async () => {
    const { db } = fakeDb(0, [t("expense", 40, "2026-10-02", "mail:x")]);
    const { delta } = await syncOpeningToStatement(db, acc, "2026-10-02", -40, new Set(), "vk:");
    expect(delta).toBe(0);
  });
});

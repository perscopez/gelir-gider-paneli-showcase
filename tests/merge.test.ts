import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findMatch, type MatchRow } from "@/lib/merge";

// Sorgu zincirini yok sayan sahte istemci: sadece satırları döndürür; asıl test eşleştirme kararı.
function fakeDb(rows: MatchRow[]) {
  const calls: Record<string, unknown[]> = {};
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte", "lte", "order", "limit", "is", "like"]) q[m] = (...a: unknown[]) => { (calls[m] ??= []).push(a); return q; };
  q.then = (res: (v: unknown) => unknown) => res({ data: rows });
  return { db: { from: () => q } as unknown as SupabaseClient, calls };
}
const row = (o: Partial<MatchRow>): MatchRow => ({ id: "t1", merchant: "LIDL SAGT DANKE", amount: 23.45, currency: "EUR", occurred_on: "2026-11-15", account_id: "a", category_id: null, note: null, ...o });
const q = { amount: 23.45, currency: "EUR", merchant: "Lidl", date: "2026-11-15" };

describe("findMatch", () => {
  it("mağaza adı eşleşirse bulur", async () => expect((await findMatch(fakeDb([row({})]).db, "u", q, "apple_pay"))?.id).toBe("t1"));
  it("mağaza adı eşleşmezse (aynı gün, tek aday olsa bile) birleştirmez", async () => {
    expect(await findMatch(fakeDb([row({ merchant: "REWE Markt" })]).db, "u", q, "apple_pay")).toBeNull();
    expect(await findMatch(fakeDb([row({ merchant: null })]).db, "u", q, "apple_pay")).toBeNull();
  });
  it("birden çok adaydan eşleşen ve tarihçe en yakın olanı seçer", async () => {
    const rows = [row({ id: "far", occurred_on: "2026-11-13" }), row({ id: "near", occurred_on: "2026-11-15" }), row({ id: "other", merchant: "REWE" })];
    expect((await findMatch(fakeDb(rows).db, "u", q, "apple_pay"))?.id).toBe("near");
  });
  it("aday yoksa null", async () => expect(await findMatch(fakeDb([]).db, "u", q, "telegram")).toBeNull());
  it("tarih penceresi: fiş sonradan gelirse ±3, Apple Pay sonradan gelirse ±1 gün", async () => {
    const a = fakeDb([]); await findMatch(a.db, "u", q, "apple_pay");
    const b = fakeDb([]); await findMatch(b.db, "u", q, "telegram");
    expect(a.calls.gte?.[1]).toEqual(["occurred_on", "2026-11-12"]);
    expect(b.calls.gte?.[1]).toEqual(["occurred_on", "2026-11-14"]);
    expect(b.calls.lte?.[1]).toEqual(["occurred_on", "2026-11-16"]);
  });
  it("Telegram modunda yalnızca hesap ipucusuz fişler (tg:) aranır; tgh: dışarıda kalır", async () => {
    const t = fakeDb([]); await findMatch(t.db, "u", q, "telegram");
    expect(t.calls.like).toEqual([["external_id", "tg:%"]]);
  });
});

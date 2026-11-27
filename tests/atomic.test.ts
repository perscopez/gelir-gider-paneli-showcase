import { describe, expect, it } from "vitest";
import { applyStatement, attachReceipt, insertTxnWithItems } from "@/lib/atomic";

// Sahte istemci: rpc sonucu ve düz tablo çağrıları kaydedilir.
function fake(rpcError: { code?: string; message: string } | null) {
  const calls: string[] = [];
  const db = {
    rpc: async (name: string) => { calls.push(`rpc:${name}`); return { data: "new-id", error: rpcError }; },
    from: (t: string) => ({
      insert: (rows: unknown) => { calls.push(`insert:${t}:${Array.isArray(rows) ? rows.length : 1}`); return { select: () => ({ single: async () => ({ data: { id: "legacy-id" }, error: null }) }), error: null, then: undefined }; },
      update: () => ({ eq: async () => { calls.push(`update:${t}`); return {}; } }),
      delete: () => ({ eq: async () => { calls.push(`delete:${t}`); return {}; } }),
    }),
  } as never;
  return { db, calls };
}

describe("atomik yazım yardımcıları", () => {
  it("RPC varsa tek çağrı yapar", async () => {
    const { db, calls } = fake(null);
    await applyStatement(db, [{ a: 1 }], [{ id: "x", patch: { amount: 1 } }]);
    expect(calls).toEqual(["rpc:apply_statement"]);
    expect(await insertTxnWithItems(db, { id: "t" }, [{ name: "x" }])).toBe("new-id");
    await attachReceipt(db, "t", { note: "n" }, [{ name: "x" }]);
    expect(calls).toEqual(["rpc:apply_statement", "rpc:insert_txn_with_items", "rpc:receipt_attach"]);
  });
  it("RPC yoksa (migration çalışmadı) eski sıralı yola düşer", async () => {
    const { db, calls } = fake({ code: "PGRST202", message: "Could not find the function" });
    await applyStatement(db, [{ a: 1 }], [{ id: "x", patch: { amount: 1 } }]);
    expect(calls).toEqual(["rpc:apply_statement", "insert:transactions:1", "update:transactions"]);
  });
  it("başka hata fırlatılır (sessizce yutulmaz)", async () => {
    const { db } = fake({ code: "23505", message: "duplicate key value" });
    await expect(applyStatement(db, [{ a: 1 }], [])).rejects.toThrow(/duplicate key/);
  });
  it("kalem yoksa düz ekleme (RPC çağrılmaz)", async () => {
    const { db, calls } = fake(null);
    expect(await insertTxnWithItems(db, { id: "t" }, [])).toBe("legacy-id");
    expect(calls).toEqual(["insert:transactions:1"]);
  });
});

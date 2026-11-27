import { describe, expect, it } from "vitest";
import { BACKUP_TABLES, buildBackup, summarizeBackup } from "@/lib/backup";

// Sahte istemci: her tabloda 2 satır; "receipt_items" tablosu yok (migration çalıştırılmamış) gibi hata verir.
function fakeDb(userFilters: string[]) {
  return {
    from(table: string) {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: string) => { userFilters.push(`${table}:${c}=${v}`); return q; },
        order: () => q,
        range: async () => (table === "receipt_items" ? { data: null, error: { message: "relation does not exist" } } : { data: [{ id: `${table}-1` }, { id: `${table}-2` }], error: null }),
      };
      return q;
    },
  } as never;
}

describe("tam yedek", () => {
  it("tüm tabloları toplar, eksik tabloyu 'missing'e yazar, hata vermez", async () => {
    const b = await buildBackup(fakeDb([]));
    expect(b.version).toBe(1);
    expect(b.counts.transactions).toBe(2);
    expect(b.missing).toEqual(["receipt_items"]);
    expect(Object.keys(b.tables)).toContain("accounts");
    expect(BACKUP_TABLES.length).toBeGreaterThan(8);
    expect(summarizeBackup(b)).toContain("transactions 2");
  });
  it("servis anahtarıyla (uid verilince) satırlar kullanıcıya göre süzülür", async () => {
    const f: string[] = [];
    await buildBackup(fakeDb(f), "u1");
    expect(f).toContain("accounts:user_id=u1");
    expect(f).toContain("transactions:user_id=u1");
  });
});

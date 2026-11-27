import { describe, expect, it } from "vitest";
import { activeBudgets, budgetLimitEur, categoryIdByKey, goalProgress } from "@/lib/customize";

const b = (o: object) => ({ id: "b", category_id: "c1", monthly_limit_eur: 100, ...o });

describe("bütçe geçerlilik aralığı", () => {
  it("aralığı olmayan bütçe her ay geçerlidir", () => expect(activeBudgets([b({})], "2026-12")).toHaveLength(1));
  it("aralığın dışındaki ay hariç tutulur", () => {
    const r = b({ valid_from: "2026-12-01", valid_to: "2027-01-31" });
    expect(activeBudgets([r], "2026-11")).toHaveLength(0);
    expect(activeBudgets([r], "2026-12")).toHaveLength(1);
    expect(activeBudgets([r], "2027-01")).toHaveLength(1);
    expect(activeBudgets([r], "2027-02")).toHaveLength(0);
  });
  it("aynı kategoride en yeni başlangıçlı bütçe kazanır (Aralık-Ocak ve Şubat sonrası ayrı limit)", () => {
    const eski = b({ id: "a", monthly_limit_eur: 260, valid_to: "2027-01-31" });
    const yeni = b({ id: "b2", monthly_limit_eur: 200, valid_from: "2027-02-01" });
    expect(activeBudgets([eski, yeni], "2027-01").map((x) => x.id)).toEqual(["a"]);
    expect(activeBudgets([eski, yeni], "2027-02").map((x) => x.id)).toEqual(["b2"]);
  });
  it("TL bütçe EUR'a çevrilir", () => {
    expect(budgetLimitEur({ monthly_limit_eur: 5500, currency: "TRY" }, 55)).toBe(100);
    expect(budgetLimitEur({ monthly_limit_eur: 100, currency: "EUR" }, 55)).toBe(100);
  });
});

describe("hedef ilerlemesi", () => {
  const accs = [{ id: "kenar", currency: "EUR", balance: 920 }, { id: "tl", currency: "TRY", balance: 5500 }];
  it("hesaba bağlı hedef hesabın bakiyesini kullanır", () => {
    expect(goalProgress({ target_eur: 1000, saved_eur: 0, account_id: "kenar" }, accs, 55)).toMatchObject({ saved: 920, linked: true });
  });
  it("farklı para birimindeki hesap çevrilir", () => {
    expect(goalProgress({ target_eur: 200, saved_eur: 0, account_id: "tl", currency: "EUR" }, accs, 55).saved).toBe(100);
  });
  it("bağlı değilse elle girilen tutar", () => expect(goalProgress({ target_eur: 500, saved_eur: 120 }, accs, 55)).toMatchObject({ saved: 120, linked: false }));
});

describe("yerleşik kategori anahtarı", () => {
  const cats = [{ id: "1", name_tr: "Bakkal", builtin_key: "Market" }, { id: "2", name_tr: "Kira" }];
  it("yeniden adlandırılan kategori anahtarla bulunur", () => expect(categoryIdByKey(cats, "Market")).toBe("1"));
  it("anahtarı olmayan kategori adla bulunur", () => expect(categoryIdByKey(cats, "Kira")).toBe("2"));
  it("bulunamazsa null", () => expect(categoryIdByKey(cats, "Seyahat")).toBeNull());
});

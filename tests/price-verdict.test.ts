import { describe, expect, it } from "vitest";
import { buildIndex, judge, median, overpay, productKey, summarizeProducts, type PricePoint } from "@/lib/price-verdict";

const p = (txn: string, price: number, merchant = "Lidl", product = "Vollmilch", unit = "l", date = "2026-11-01"): PricePoint => ({ txn, product, unit, price, merchant, date });

describe("medyan ve anahtar", () => {
  it("medyan tek/çift sayıda", () => { expect(median([3, 1, 2])).toBe(2); expect(median([1, 2, 3, 4])).toBe(2.5); });
  it("ürün anahtarı büyük/küçük harf ve noktalamadan bağımsız", () => expect(productKey("Vollmilch 3,5%", "l")).toBe(productKey("vollmilch 3 5", "l")));
});

describe("fiyat değerlendirmesi", () => {
  const hist = buildIndex([p("a", 1.0), p("b", 1.1), p("c", 1.05), p("d", 1.2, "Rewe")]); // medyan 1,075
  it("medyanın %8 altı ucuz", () => expect(judge(0.9, "Vollmilch", "l", hist)).toMatchObject({ level: "cheap", n: 4 }));
  it("medyana yakın normal", () => expect(judge(1.1, "Vollmilch", "l", hist).level).toBe("fair"));
  it("medyanın %8 üstü pahalı, yüzde ve medyan döner", () => {
    const v = judge(1.4, "Vollmilch", "l", hist);
    expect(v.level).toBe("expensive");
    expect(v.median).toBeCloseTo(1.075, 3);
    expect(v.pct).toBeCloseTo(0.302, 2);
  });
  it("en ucuz mağazayı bulur", () => expect(judge(1.4, "Vollmilch", "l", hist).cheapestStore).toBe("Lidl"));
  it("az veri (2'den az başka alım) 'new' döner", () => {
    expect(judge(5, "Yeni ürün", "kg", hist).level).toBe("new");
    expect(judge(1, "Vollmilch", "l", buildIndex([p("a", 1)])).level).toBe("new");
  });
  it("değerlendirilen fişin kendi kalemleri ortalamaya girmez", () => {
    const idx = buildIndex([p("x", 5), p("a", 1), p("b", 1.1), p("c", 1.05)]);
    expect(judge(1.4, "Vollmilch", "l", idx, "x").median).toBeCloseTo(1.05, 2);
  });
  it("farklı birim ayrı ürün sayılır; fiyatsız/geçersiz girdi güvenli", () => {
    expect(judge(1, "Vollmilch", "kg", hist).level).toBe("new");
    expect(judge(null, "Vollmilch", "l", hist).level).toBe("new");
    expect(judge(0, null, "l", hist).level).toBe("new");
  });
  it("tahmini fazla ödeme: pahalıysa toplam × (1 − medyan/fiyat)", () => {
    const v = judge(1.4, "Vollmilch", "l", hist);
    expect(overpay(2.8, 1.4, v)).toBeCloseTo(2.8 * (1 - 1.075 / 1.4), 3);
    expect(overpay(2, 1.0, judge(1.0, "Vollmilch", "l", hist))).toBe(0);
  });
  it("ürün özeti: sayı, son fiyat, min/max", () => {
    const s = summarizeProducts(hist)[0];
    expect(s).toMatchObject({ count: 4, min: 1, max: 1.2 });
  });
});

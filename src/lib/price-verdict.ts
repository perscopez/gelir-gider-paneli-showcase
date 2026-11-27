// Market fiyat değerlendirmesi: bir ürünün birim fiyatı (€/kg, €/l, €/adet) kendi geçmiş alımlarının medyanına göre ucuz / normal / pahalı mı?
// Saf fonksiyonlar (veritabanına dokunmaz), test edilir.

export type PricePoint = { txn: string; product: string; unit: string; price: number; merchant: string | null; date: string };
export type Level = "cheap" | "fair" | "expensive" | "new";
export type ItemVerdict = { level: Level; pct: number | null; median: number | null; n: number; min: number | null; max: number | null; cheapestStore: string | null; cheapestAvg: number | null };

export const CHEAP_BELOW = -0.08;   // medyanın %8 altı → ucuz
export const EXPENSIVE_ABOVE = 0.08; // medyanın %8 üstü → pahalı
export const MIN_OTHERS = 2;         // karşılaştırma için bu ürünün en az 2 başka alımı olmalı

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export const productKey = (product: string, unit: string) => `${norm(product)}|${unit}`;

export function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export type PriceIndex = Map<string, PricePoint[]>;
export function buildIndex(points: PricePoint[]): PriceIndex {
  const idx: PriceIndex = new Map();
  for (const p of points) {
    if (!(p.price > 0)) continue;
    const k = productKey(p.product, p.unit);
    idx.set(k, [...(idx.get(k) ?? []), p]);
  }
  return idx;
}

// `excludeTxn`: değerlendirilen fişin kendi kalemleri ortalamaya girmez.
export function judge(price: number | null | undefined, product: string | null | undefined, unit: string | null | undefined, index: PriceIndex, excludeTxn?: string): ItemVerdict {
  const empty: ItemVerdict = { level: "new", pct: null, median: null, n: 0, min: null, max: null, cheapestStore: null, cheapestAvg: null };
  if (!price || price <= 0 || !product || !unit) return empty;
  const others = (index.get(productKey(product, unit)) ?? []).filter((p) => p.txn !== excludeTxn);
  if (others.length < MIN_OTHERS) return { ...empty, n: others.length };
  const prices = others.map((p) => p.price);
  const med = median(prices);
  const pct = price / med - 1;
  // En ucuz mağaza (ortalama birim fiyat; her mağazadan en az 1 alım)
  const byStore = new Map<string, number[]>();
  for (const p of others) if (p.merchant) byStore.set(p.merchant, [...(byStore.get(p.merchant) ?? []), p.price]);
  let cheapestStore: string | null = null, cheapestAvg: number | null = null;
  for (const [m, ps] of byStore) {
    const avg = ps.reduce((a, b) => a + b, 0) / ps.length;
    if (cheapestAvg === null || avg < cheapestAvg) { cheapestAvg = avg; cheapestStore = m; }
  }
  return {
    level: pct <= CHEAP_BELOW ? "cheap" : pct >= EXPENSIVE_ABOVE ? "expensive" : "fair",
    pct, median: med, n: others.length, min: Math.min(...prices), max: Math.max(...prices), cheapestStore, cheapestAvg,
  };
}

// Pahalı alınan bir satırda tahmini fazla ödeme: toplam × (1 − medyan/fiyat).
export const overpay = (lineTotal: number, price: number, v: ItemVerdict) =>
  v.level === "expensive" && v.median && price > 0 ? Math.max(0, lineTotal * (1 - v.median / price)) : 0;

// Ürün başına özet (geçmiş tablosu): kaç kez alındı, son fiyat, medyan, min/max, son alımın değerlendirmesi.
export type ProductSummary = { key: string; product: string; unit: string; count: number; last: PricePoint; median: number; min: number; max: number; verdict: ItemVerdict; spent: number };
export function summarizeProducts(index: PriceIndex): ProductSummary[] {
  const out: ProductSummary[] = [];
  for (const [key, pts] of index) {
    const sorted = [...pts].sort((a, b) => b.date.localeCompare(a.date));
    const last = sorted[0];
    const prices = pts.map((p) => p.price);
    out.push({
      key, product: last.product, unit: last.unit, count: pts.length, last, median: median(prices), min: Math.min(...prices), max: Math.max(...prices),
      verdict: judge(last.price, last.product, last.unit, index, last.txn), spent: 0,
    });
  }
  return out.sort((a, b) => b.last.date.localeCompare(a.last.date));
}

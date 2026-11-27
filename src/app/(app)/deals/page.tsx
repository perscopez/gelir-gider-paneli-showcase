import { BadgePercent } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/i18n";
import { addDaysISO, todayISO } from "@/lib/date";
import { fetchAll } from "@/lib/paginate";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { DealCard } from "@/components/deal-card";

export const metadata = { title: "Fırsatlar" };

type Row = { product: string | null; brand: string | null; base_unit: string | null; price_per_base: number | null; line_total: number; purchased_on: string | null };

export default async function DealsPage() {
  const locale = await getLocale();
  const tr = locale === "tr";
  const supabase = await createClient();
  let data: Row[] | null = null;
  let error: { message: string } | null = null;
  try {
    data = await fetchAll<Row>((a, b) => supabase.from("receipt_items").select("product,brand,base_unit,price_per_base,line_total,purchased_on")
      .gte("purchased_on", addDaysISO(todayISO(), -120)).gt("line_total", 0).not("product", "is", null).order("purchased_on", { ascending: false }).order("id").range(a, b));
  } catch (e) { error = e as Error; }
  const title = tr ? "Fırsatlar" : "Deals";

  if (error || !data?.length) {
    return (
      <>
        <PageHeader title={title} />
        <EmptyState icon={BadgePercent} title={tr ? "Henüz fiş kalemi yok" : "No receipt items yet"}
          description={tr ? "Telegram'a market fişi attıkça sık aldığın ürünler için bu hafta hangi markette indirim olduğunu KaufDA'dan gösteririm." : "Once you send grocery receipts, I show this week's discounts for the products you buy often, from KaufDA."} />
      </>
    );
  }

  // Sık alınan ürünler: aynı ürün+marka, alış sayısına göre; ortalama birim fiyat karşılaştırma için
  const groups = new Map<string, { name: string; brand: string | null; unit: string | null; n: number; ppbSum: number; ppbN: number; spend: number; last: string | null }>();
  for (const r of data as Row[]) {
    if (!r.product) continue;
    const key = `${(r.brand ?? "").toLowerCase()}|${r.product.toLowerCase()}`;
    const g = groups.get(key) ?? { name: r.product, brand: r.brand, unit: r.base_unit, n: 0, ppbSum: 0, ppbN: 0, spend: 0, last: null };
    g.n += 1; g.spend += Number(r.line_total);
    if (r.price_per_base && r.base_unit && (!g.unit || g.unit === r.base_unit)) { g.unit = r.base_unit; g.ppbSum += Number(r.price_per_base); g.ppbN += 1; }
    if (r.purchased_on && (!g.last || r.purchased_on > g.last)) g.last = r.purchased_on;
    groups.set(key, g);
  }
  // Benzer ürünler: aynı ürün adı, markadan bağımsız ortalama birim fiyat
  const byProduct = new Map<string, { sum: number; n: number }>();
  for (const g of groups.values()) if (g.unit && g.ppbN) { const k = `${g.name.toLowerCase()}|${g.unit}`; const a = byProduct.get(k) ?? { sum: 0, n: 0 }; a.sum += g.ppbSum; a.n += g.ppbN; byProduct.set(k, a); }
  const top = [...groups.values()].sort((a, b) => b.n - a.n || b.spend - a.spend).slice(0, 18)
    .map((g) => { const all = g.unit ? byProduct.get(`${g.name.toLowerCase()}|${g.unit}`) : undefined; return { name: g.name, brand: g.brand, unit: g.unit, ppb: g.ppbN ? g.ppbSum / g.ppbN : null, ppbAll: all ? all.sum / all.n : null, count: g.n, lastPaid: g.last }; });

  return (
    <div className="max-w-3xl">
      <PageHeader title={title} description={tr ? "Sık aldığın ürünler için bu haftaki market fırsatları (KaufDA broşürleri). Tasarruf, senin ortalama ödediğin birim fiyata göre." : "This week's store deals for products you buy often (KaufDA flyers). Savings are versus your average unit price."} />
      <ul className="space-y-3">
        {top.map((q) => (
          <DealCard key={`${q.brand}|${q.name}`} q={q} locale={locale} labels={{ none: tr ? "Fırsat yok" : "No deal", saving: tr ? "ucuz" : "cheaper", until: tr ? "şu tarihe kadar" : "until", bought: tr ? "aldın" : "bought", open: tr ? "KaufDA'da tüm fırsatlar" : "All deals on KaufDA", normal: tr ? "için normalde" : "usually costs", avgMine: tr ? "senin ortalaman" : "your average", avgAll: tr ? "benzer ürünler ort." : "similar products avg" }} />
        ))}
      </ul>
      <p className="mt-6 text-xs text-muted-foreground">{tr ? "Kaynak: kaufda.de. Resmi bir API yok; sayfa yapısı değişirse ya da fırsat bulunamazsa kart görünmez. Fiyatlar bölgeye göre değişebilir." : "Source: kaufda.de. There is no official API; cards disappear if the page changes or no deal is found. Prices can vary by region."}</p>
    </div>
  );
}

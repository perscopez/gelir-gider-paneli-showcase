import Link from "next/link";
import { ShoppingBasket } from "lucide-react";
import { addDaysISO, todayISO } from "@/lib/date";
import { fetchAll } from "@/lib/paginate";
import { createClient } from "@/lib/supabase/server";
import { getLocale, t } from "@/lib/i18n";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { receiptLabels } from "@/lib/receipt-labels";
import { ReceiptItems, TripDetails, type ReceiptLine } from "@/components/receipt-items";
import { Badge } from "@/components/ui/badge";
import { loadPriceIndex } from "@/lib/price-data";
import { judge, overpay, summarizeProducts, type ItemVerdict } from "@/lib/price-verdict";

export const metadata = { title: "Market" };

type Item = ReceiptLine & { transaction_id: string; merchant: string | null; purchased_on: string | null };
const unitName = (u: string, tr: boolean) => (u === "pcs" ? (tr ? "adet" : "pc") : u);

export default async function GroceriesPage({ searchParams }: PageProps<"/groceries">) {
  const locale = await getLocale();
  const L = t(locale);
  const tr = locale === "tr";
  const supabase = await createClient();
  const q = String((await searchParams).q ?? "").trim().toLowerCase();
  const since = addDaysISO(todayISO(), -180);
  let data: Item[] | null = null;
  let error: { message: string } | null = null;
  try {
    data = await fetchAll<Item>((a, b) => supabase
      .from("receipt_items").select("transaction_id,line_no,product,brand,name,quantity,unit,pack_amount,pack_unit,unit_price,category,line_total,base_unit,price_per_base,merchant,purchased_on,currency")
      .eq("currency", "EUR").gte("purchased_on", since).order("purchased_on", { ascending: false }).order("id").range(a, b));
  } catch (e) { error = e as Error; }

  const title = tr ? "Market" : "Groceries";
  const index = await loadPriceIndex(supabase);
  // Her ürün kalemi kendi geçmiş fiyat medyanına göre değerlendirilir (aynı fişin kalemleri ortalamaya girmez).
  const items = (data ?? []).map((i) => ({ ...i, verdict: judge(i.price_per_base ? Number(i.price_per_base) : null, i.product, i.base_unit, index, i.transaction_id) as ItemVerdict }));
  if (error || !items.length) {
    return (
      <>
        <PageHeader title={title} />
        <EmptyState icon={ShoppingBasket} title={tr ? "Henüz fiş kalemi yok" : "No receipt items yet"}
          description={tr ? "Telegram'a bir market fişi fotoğrafı gönder; kalemler burada fiyat karşılaştırmasına girer. (Supabase'de 0002_receipt_items.sql çalıştırılmış olmalı.)" : "Send a grocery receipt photo to Telegram; items appear here for price comparison. (Run 0002_receipt_items.sql in Supabase first.)"} />
      </>
    );
  }
  const eur = (n: number) => new Intl.NumberFormat(tr ? "tr-TR" : "en-GB", { style: "currency", currency: "EUR" }).format(n);

  // Kategori harcaması (indirimler ve depozito dahil net)
  const byCat = new Map<string, number>();
  for (const i of items) byCat.set(i.category, (byCat.get(i.category) ?? 0) + Number(i.line_total));
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(...cats.map(([, v]) => Math.abs(v)), 1);

  // Ürün başına mağaza karşılaştırması: aynı ürünün birim fiyatı farklı mağazalarda
  type Agg = { unit: string; stores: Map<string, { sum: number; n: number }> };
  const products = new Map<string, Agg>();
  for (const i of items) {
    if (!i.product || !i.base_unit || !i.price_per_base || !i.merchant) continue;
    const key = `${i.product}|${i.base_unit}`;
    const a = products.get(key) ?? { unit: i.base_unit, stores: new Map() };
    const s = a.stores.get(i.merchant) ?? { sum: 0, n: 0 };
    s.sum += Number(i.price_per_base); s.n += 1;
    a.stores.set(i.merchant, s);
    products.set(key, a);
  }
  const compare = [...products.entries()]
    .map(([key, a]) => {
      const stores = [...a.stores.entries()].map(([m, s]) => ({ m, avg: s.sum / s.n, n: s.n })).sort((x, y) => x.avg - y.avg);
      return { name: key.split("|")[0], unit: a.unit, stores, saving: stores.length > 1 ? (stores[stores.length - 1].avg - stores[0].avg) / stores[stores.length - 1].avg : 0 };
    })
    .filter((p) => p.stores.length > 1)
    .sort((a, b) => b.saving - a.saving)
    .slice(0, 12);

  // Alışveriş (fiş) başına grup: yeni tarih önce, her fişin en büyük kategorileri özet satırda
  const tripMap = new Map<string, Item[]>();
  for (const i of items) tripMap.set(i.transaction_id, [...(tripMap.get(i.transaction_id) ?? []), i]);
  const trips = [...tripMap.entries()]
    .map(([id, its]) => {
      const sorted = its.sort((a, b) => a.line_no - b.line_no);
      const byCat = new Map<string, number>();
      for (const i of sorted) if (i.line_total > 0) byCat.set(i.category, (byCat.get(i.category) ?? 0) + Number(i.line_total));
      return {
        id, items: sorted, merchant: sorted[0].merchant, date: sorted[0].purchased_on ?? "", sum: sorted.reduce((a, i) => a + Number(i.line_total), 0),
        top: [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, v]) => `${c} ${eur(v)}`).join(" · "),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 40);

  const total = items.filter((i) => i.line_total > 0).reduce((a, i) => a + Number(i.line_total), 0);

  return (
    <div className="space-y-6">
      <PageHeader title={title} description={tr ? `Son 6 ay · ${items.length} kalem · ${eur(total)}` : `Last 6 months · ${items.length} items · ${eur(total)}`} />

      {(() => {
        // Son 30 günde pahalı alınanlar + tahmini fazla ödeme
        const recent = addDaysISO(todayISO(), -30);
        const pricey = items
          .filter((i) => i.verdict.level === "expensive" && (i.purchased_on ?? "") >= recent && Number(i.line_total) > 0 && i.price_per_base)
          .map((i) => ({ i, extra: overpay(Number(i.line_total), Number(i.price_per_base), i.verdict) }))
          .sort((a, b) => b.extra - a.extra);
        const cheap = items.filter((i) => i.verdict.level === "cheap" && (i.purchased_on ?? "") >= recent && Number(i.line_total) > 0).length;
        const extraTotal = pricey.reduce((a, x) => a + x.extra, 0);
        return (
          <section className="rounded-xl border bg-card p-5 shadow-xs">
            <h2 className="mb-1 font-medium">{tr ? "Son 30 gün: fiyat değerlendirmesi" : "Last 30 days: price check"}</h2>
            <p className="mb-4 text-sm text-muted-foreground">{tr ? "Her ürün kendi geçmiş alımlarının medyanıyla kıyaslanır (±%8 normal). En az 2 önceki alım gerekir." : "Each product is compared with the median of your own past purchases (±8% is fair). Needs at least 2 earlier purchases."}</p>
            <div className="mb-4 flex flex-wrap gap-3 text-sm">
              <Badge variant="outline" className="bg-red-500/10 text-red-700 dark:text-red-400">{pricey.length} {tr ? "pahalı" : "pricey"}</Badge>
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">{cheap} {tr ? "ucuz" : "cheap"}</Badge>
              {extraTotal > 0 ? <span className="text-muted-foreground">{tr ? "Tahmini fazla ödeme" : "Est. overpaid"}: <b className="text-foreground">{eur(extraTotal)}</b></span> : null}
            </div>
            {!pricey.length ? <p className="text-sm text-muted-foreground">{tr ? "Pahalı alınan ürün yok (ya da henüz yeterli geçmiş yok)." : "Nothing pricey (or not enough history yet)."}</p> : (
              <ul className="divide-y">
                {pricey.slice(0, 8).map(({ i, extra }) => (
                  <li key={`${i.transaction_id}-${i.line_no}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className="min-w-0"><span className="font-medium">{i.product ?? i.name}</span> <span className="text-xs text-muted-foreground">{i.merchant} · {i.purchased_on}</span></span>
                    <span className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="tabular-nums">{eur(Number(i.price_per_base))}/{unitName(i.base_unit ?? "", tr)}</span>
                      <span className="text-muted-foreground">{tr ? "ort." : "med."} {eur(i.verdict.median ?? 0)}</span>
                      <Badge variant="outline" className="bg-red-500/10 text-red-700 dark:text-red-400">+{Math.round((i.verdict.pct ?? 0) * 100)}%</Badge>
                      {i.verdict.cheapestStore ? <span className="text-muted-foreground">{tr ? "en ucuz" : "cheapest"}: {i.verdict.cheapestStore}</span> : null}
                      <span className="text-red-600 dark:text-red-400">−{eur(extra)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })()}

      {(() => {
        // Ürün fiyat geçmişi: aranabilir, ürün başına alım sayısı, son fiyat, medyan, min–max, son alımın değerlendirmesi
        const all = summarizeProducts(index).filter((s) => !q || s.product.toLowerCase().includes(q));
        const tone = (l: string) => (l === "cheap" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : l === "expensive" ? "bg-red-500/10 text-red-700 dark:text-red-400" : "");
        return (
          <section className="rounded-xl border bg-card p-5 shadow-xs">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-medium">{tr ? "Ürün fiyat geçmişi" : "Product price history"}</h2>
                <p className="text-sm text-muted-foreground">{tr ? `Son 12 ay · ${all.length} ürün. Birim fiyat: €/kg, €/l, €/adet.` : `Last 12 months · ${all.length} products. Unit price: €/kg, €/l, €/pc.`}</p>
              </div>
              <form method="get" className="flex gap-2">
                <input name="q" defaultValue={q} placeholder={tr ? "Ürün ara…" : "Search product…"} className="h-9 w-44 rounded-lg border bg-background px-3 text-sm" />
              </form>
            </div>
            {!all.length ? <p className="text-sm text-muted-foreground">{tr ? "Eşleşen ürün yok." : "No matching product."}</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr><th className="py-1.5 pr-3 font-normal">{tr ? "Ürün" : "Product"}</th><th className="pr-3 font-normal">{tr ? "Alım" : "Buys"}</th><th className="pr-3 font-normal">{tr ? "Son fiyat" : "Last"}</th><th className="pr-3 font-normal">{tr ? "Medyan" : "Median"}</th><th className="pr-3 font-normal">{tr ? "Min–Maks" : "Min–Max"}</th><th className="font-normal">{tr ? "Son alım" : "Last buy"}</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {all.slice(0, 60).map((s) => (
                      <tr key={s.key}>
                        <td className="py-2 pr-3"><span className="font-medium">{s.product}</span> <span className="text-xs text-muted-foreground">€/{unitName(s.unit, tr)}</span></td>
                        <td className="pr-3 tabular-nums">{s.count}</td>
                        <td className="pr-3 tabular-nums">{eur(s.last.price)} <span className="text-xs text-muted-foreground">{s.last.merchant ?? ""} · {s.last.date.slice(5)}</span></td>
                        <td className="pr-3 tabular-nums">{eur(s.median)}</td>
                        <td className="pr-3 tabular-nums text-xs text-muted-foreground">{eur(s.min)}–{eur(s.max)}</td>
                        <td>{s.verdict.level === "new" || s.verdict.pct === null ? <span className="text-xs text-muted-foreground">{tr ? "yeni" : "new"}</span> : <Badge variant="outline" className={tone(s.verdict.level)}>{s.verdict.level === "cheap" ? (tr ? "Ucuz" : "Cheap") : s.verdict.level === "expensive" ? (tr ? "Pahalı" : "Pricey") : (tr ? "Normal" : "Fair")} {s.verdict.pct > 0 ? "+" : ""}{Math.round(s.verdict.pct * 100)}%</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })()}

      <section className="rounded-xl border bg-card p-5 shadow-xs">
        <h2 className="mb-1 font-medium">{tr ? "Aynı ürün, farklı mağaza" : "Same product, different store"}</h2>
        <p className="mb-4 text-sm text-muted-foreground">{tr ? "Birim fiyat (€/kg, €/l, €/adet) ortalaması; en ucuz mağaza yeşil." : "Average unit price (€/kg, €/l, €/pc); cheapest store in green."}</p>
        {!compare.length ? (
          <p className="text-sm text-muted-foreground">{tr ? "Karşılaştırma için aynı ürünün en az iki mağazadan fişi gerekir." : "Needs receipts for the same product from at least two stores."}</p>
        ) : (
          <ul className="divide-y">
            {compare.map((p) => (
              <li key={p.name + p.unit} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <span className="min-w-0 font-medium">{p.name} <span className="text-xs font-normal text-muted-foreground">€/{p.unit === "pcs" ? (tr ? "adet" : "pc") : p.unit}</span></span>
                <span className="flex flex-wrap items-center gap-2">
                  {p.stores.map((s, i) => (
                    <Badge key={s.m} variant={i === 0 ? "default" : "outline"} className={i === 0 ? "bg-emerald-600 text-white" : ""}>{s.m} {s.avg.toFixed(2)}</Badge>
                  ))}
                  <span className="text-xs text-emerald-600 dark:text-emerald-400">−{Math.round(p.saving * 100)}%</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border bg-card p-5 shadow-xs">
        <h2 className="mb-1 font-medium">{tr ? "Alışverişler" : "Shopping trips"}</h2>
        <p className="mb-4 text-sm text-muted-foreground">{tr ? "Her fiş: mağaza, tarih, kalem sayısı ve toplam. Açınca kalemler, birim fiyatlar, ürün fotoğrafı ve linki görünür." : "Each receipt: store, date, item count and total. Open it for items, unit prices, product photo and link."}</p>
        <ul className="space-y-2">
          {trips.map((t) => (
            <li key={t.id}>
              <TripDetails
                summary={
                  <>
                    <span className="min-w-0">
                      <span className="font-medium">{t.merchant ?? "?"}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{t.date} · {t.items.length} {tr ? "kalem" : "items"}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{t.top}</span>
                    </span>
                    <span className="tabular-nums font-semibold">{eur(t.sum)}</span>
                  </>
                }
              >
                <ReceiptItems items={t.items} locale={locale} labels={receiptLabels(tr)} />
              </TripDetails>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border bg-card p-5 shadow-xs">
        <h2 className="mb-4 font-medium">{tr ? "Kategoriye göre" : "By category"}</h2>
        <ul className="space-y-2.5">
          {cats.map(([c, v]) => (
            <li key={c} className="text-sm">
              <div className="mb-1 flex justify-between"><span>{c}</span><span className="tabular-nums text-muted-foreground">{eur(v)}</span></div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${v < 0 ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${(Math.abs(v) / maxCat) * 100}%` }} /></div>
            </li>
          ))}
        </ul>
      </section>
      <p className="text-xs text-muted-foreground"><Link href="/transactions" className="underline">{L.transactions}</Link></p>
    </div>
  );
}

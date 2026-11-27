import { tokens } from "@/lib/product-lookup";

// KaufDA (kaufda.de) haftalık market broşürlerinden ürün fırsatları. Resmi bir API yok: herkese açık ürün sayfasındaki (kaufda.de/Angebote/<ürün>)
// yapılandırılmış veri okunur. Sayfa yapısı değişirse ya da erişim engellenirse sonuç boş döner (hata vermez). Sonuçlar 6 saat önbelleğe alınır.
export type Deal = {
  retailer: string; title: string; brand: string | null; price: number; priceText: string; perBase: { value: number; unit: string } | null;
  validFrom: string; validUntil: string; image: string | null; imageLarge?: string | null; note: string; saving?: number;
};
export type DealResult = { url: string | null; offers: Deal[] };

const slugWord = (w: string) => (w.charAt(0).toUpperCase() + w.slice(1)).replace(/ä/gi, "ae").replace(/ö/gi, "oe").replace(/ü/gi, "ue").replace(/ß/g, "ss").replace(/[^A-Za-z0-9-]/g, "");
export const kaufdaSlug = (s: string) => s.trim().split(/\s+/).map(slugWord).filter(Boolean).join("-");
export const kaufdaUrl = (s: string) => `https://www.kaufda.de/Angebote/${kaufdaSlug(s)}`;

type Raw = {
  publisherName?: string; title?: string; description?: string; brand?: string; validFrom?: string; validUntil?: string;
  offerImages?: { url?: { normal?: string; thumbnail?: string; large?: string } }; prices?: { mainPrice?: number; mainPriceFormatted?: string; priceByBaseUnit?: string };
};

const fold = (s: string) => s.toLowerCase().replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, " ");
const stemOf = (w: string) => (w.replace(/(en|er|e|n|s)$/, "").length >= 4 ? w.replace(/(en|er|e|n|s)$/, "") : w);
const OTHER = /schoko|choco|kuchen|pudding|\beis\b|eis\w*|keks|praline|riegel|gummi|spielzeug|lego|playstation|konsole|geschenk|make up|tlg|kosmetik|schwamm/;

// KaufDA başlıkları bileşik kelime kullanır ("Hähnchenbrustfilets"): sorgunun her kelimesi (kök olarak) metinde geçmeli; ilgisiz tatlı/oyuncak sonuçları elenir.
export function dealRelevant(q: { name: string; brand?: string | null }, text: string, offerBrand?: string | null) {
  const hay = fold(`${text} ${offerBrand ?? ""}`);
  const qt = tokens(q.name);
  if (!qt.length) return false;
  if (!qt.every((t) => hay.includes(stemOf(t)))) return false;
  const qname = fold(q.name);
  const other = hay.match(OTHER)?.[0];
  if (other && !qname.includes(other.trim())) return false;
  return true;
}

const parsePerBase = (s?: string) => {
  const m = s?.match(/1\s*(kg|l|stk|st)\s*=\s*([\d.,]+)/i);
  if (!m) return null;
  const value = Number(m[2].replace(",", "."));
  return Number.isFinite(value) ? { value, unit: /^st/i.test(m[1]) ? "pcs" : m[1].toLowerCase() } : null;
};

async function page(keyword: string, f: typeof fetch): Promise<{ url: string; items: Raw[] } | null> {
  const slug = kaufdaSlug(keyword);
  if (slug.length < 3) return null;
  const url = `https://www.kaufda.de/Angebote/${slug}`;
  try {
    const r = await f(url, {
      headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36", "accept-language": "de-DE,de;q=0.9" },
      signal: AbortSignal.timeout(9000), next: { revalidate: 60 * 60 * 6 },
    } as RequestInit);
    if (!r.ok) return null;
    const html = await r.text();
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return null;
    const j = JSON.parse(m[1]) as { props?: { pageProps?: { pageInformation?: { offers?: { main?: { items?: Raw[] } } } } } };
    return { url, items: j.props?.pageProps?.pageInformation?.offers?.main?.items ?? [] };
  } catch { return null; }
}

// Ürün adına gerçekten uyan, hâlâ geçerli (ya da 3 gün içinde başlayacak) fırsatlar; kendi ödediğin birim fiyata göre tasarruf hesaplanır.
export async function findDeals(q: { name: string; brand?: string | null; ppb?: number | null; unit?: string | null }, f: typeof fetch = fetch, now = new Date()): Promise<DealResult> {
  // Sıra: ürün adı (marka zaten içindeyse yeterli), sonra marka+ad, sonra yalnızca marka. İlk dolu sayfa kullanılır.
  const nameHasBrand = q.brand ? q.name.toLowerCase().includes(q.brand.toLowerCase()) : false;
  const keywords = [q.name, !nameHasBrand && q.brand ? `${q.brand} ${q.name}` : "", q.brand ?? ""].filter((k, i, a) => k && a.indexOf(k) === i);
  let found: { url: string; items: Raw[] } | null = null;
  for (const k of keywords.slice(0, 3)) {
    const p = await page(k, f);
    if (p?.items.length) { found = p; break; }
  }
  if (!found) return { url: null, offers: [] };

  const horizon = now.getTime() + 3 * 864e5;
  const offers = found.items.flatMap((o): Deal[] => {
    const price = o.prices?.mainPrice;
    if (!o.title || !price || !o.publisherName || !o.validUntil) return [];
    const until = new Date(o.validUntil).getTime();
    const from = o.validFrom ? new Date(o.validFrom).getTime() : 0;
    if (until < now.getTime() || from > horizon) return [];
    const text = `${o.title} ${o.description ?? ""}`;
    if (!dealRelevant(q, text, o.brand)) return []; // KaufDA anahtar kelime sayfaları gevşek: alakasızları ele
    const perBase = parsePerBase(o.prices?.priceByBaseUnit);
    const saving = q.ppb && q.unit && perBase && perBase.unit === q.unit && q.ppb > 0 ? 1 - perBase.value / q.ppb : undefined;
    return [{
      retailer: o.publisherName, title: o.title, brand: o.brand ?? null, price, priceText: o.prices?.mainPriceFormatted ?? `${price} €`, perBase,
      validFrom: o.validFrom ?? "", validUntil: o.validUntil, image: o.offerImages?.url?.normal ?? o.offerImages?.url?.thumbnail ?? null, imageLarge: o.offerImages?.url?.large ?? o.offerImages?.url?.normal ?? null, note: (o.description ?? "").slice(0, 100), saving,
    }];
  });
  // Aynı mağaza + başlık + fiyat tekrarları (broşürün farklı sayfaları) tek satır
  const seen = new Set<string>();
  const uniq = offers.filter((d) => { const k = `${d.retailer}|${d.title}|${d.price}`; if (seen.has(k)) return false; seen.add(k); return true; });
  uniq.sort((a, b) => (b.saving ?? -9) - (a.saving ?? -9) || (a.perBase?.value ?? a.price) - (b.perBase?.value ?? b.price));
  return { url: found.url, offers: uniq.slice(0, 6) };
}

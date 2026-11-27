// Fiş kalemi için ürün fotoğrafı/link bulur. Sıra: 1) fişin kesildiği marketin kendi sitesi (varsa), 2) Open Food Facts (market ile eşleşene bonus),
// 3) markasız/genel ürünler için Wikimedia Commons örnek görseli. Her aday puanlanır; düşük puanlı eşleşme gösterilmez (yanlış fotoğraf < boş kutu).

export type Level = "high" | "medium" | "low";

// Dış kaynaktan (Open Food Facts, kullanıcı seçimi) gelen URL'ler href/src olarak basılır: sadece http(s) kabul edilir (javascript: vb. XSS'i önler).
export const httpUrl = (u: string | null | undefined): string | null => {
  if (!u) return null;
  try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:" ? x.toString() : null; } catch { return null; }
};
export type Candidate = { image: string; url: string | null; title: string; source: string; score: number; generic?: boolean };
export type Lookup = {
  best: (Candidate & { level: Level }) | null;
  alternatives: Candidate[];
  storeSearch: { name: string; url: string } | null;
  webSearch: string;
};
import { brandInText, ownBrandsFor } from "@/lib/store-brands";

export type Query = { raw?: string | null; ownBrands?: string[]; name: string; brand?: string | null; merchant?: string | null; packAmount?: number | null; packUnit?: string | null; category?: string | null; currency?: string | null };

type Fetcher = typeof fetch;

// ── Metin normalleştirme ──
const fold = (s: string) =>
  s.toLowerCase().replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss").replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ç/g, "c")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "");
const STOP = new Set(["bio", "the", "und", "mit", "von", "der", "die", "das", "aus", "fur", "for", "pro", "ca", "stk", "stuck", "pack", "packung", "sorte"]);
export const tokens = (s: string) =>
  fold(s).replace(/\d+([.,]\d+)?\s*(kg|g|ml|cl|l|x|st)\b/g, " ").replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length >= 3 && !STOP.has(w));

// Almanca çoğul/çekim ekini atıp kök karşılaştırır: Bananen = Banane; ama "Bananenchips" farklı bir üründür (içerme yalnızca kısmi sayılır).
const stem = (w: string) => w.replace(/(en|er|e|n|s)$/, "");
const tokScore = (a: string, b: string) => (stem(a) === stem(b) ? 1 : Math.min(a.length, b.length) >= 5 && (a.includes(b) || b.includes(a)) ? 0.4 : 0);
const tokMatch = (a: string, b: string) => tokScore(a, b) === 1;

export function score(q: Query, cand: { title: string; brands?: string; stores?: string; quantity?: string }): number {
  const qt = tokens([q.brand ?? "", q.name].join(" "));
  if (!qt.length) return 0;
  const hay = tokens(`${cand.title} ${cand.brands ?? ""}`);
  let covered = qt.reduce((a, t) => a + Math.max(0, ...hay.map((h) => tokScore(t, h))), 0) / qt.length;
  // Bitişik/ayrı yazım: "Redbull" = "Red Bull" (ardışık kelimelerin birleşimi tam eşleşir; "Bananen" ≠ "Bananenchips" kalır)
  const qj = qt.join("");
  const windows = (arr: string[]) => arr.flatMap((_, i) => [1, 2, 3].filter((n) => i + n <= arr.length).map((n) => arr.slice(i, i + n).join("")));
  if (qj.length >= 5 && (windows(hay).includes(qj) || (qt.length > 1 && hay.includes(qj)))) covered = Math.max(covered, 1);
  else if (qt.length === 1 && windows(hay).some((w) => w.length >= 5 && stem(w) === stem(qt[0]))) covered = Math.max(covered, 1);
  let s = 0.7 * covered;
  if (q.brand) {
    const bt = tokens(q.brand);
    if (bt.length && bt.every((t) => tokens(`${cand.brands ?? ""} ${cand.title}`).some((h) => tokMatch(t, h)))) s += 0.15;
  }
  if (!q.brand && q.ownBrands?.length && cand.brands) {
    // Fişte marka yok: marketin özel markalarından biri adayda geçiyorsa bonus (Lidl + Milbona gibi)
    const cb = fold(cand.brands).replace(/[^a-z0-9,]/g, "");
    if (q.ownBrands.some((b) => cb.includes(fold(b).replace(/[^a-z0-9]/g, "")))) s += 0.1;
  }
  if (q.merchant && cand.stores) {
    const m = fold(q.merchant).replace(/[^a-z0-9]/g, "");
    if (m.length >= 3 && fold(cand.stores).replace(/[^a-z0-9,]/g, "").includes(m)) s += 0.1;
  }
  if (q.packAmount && q.packUnit) {
    const want = `${q.packAmount}${q.packUnit}`.toLowerCase().replace(/\s/g, "");
    if (fold(`${cand.quantity ?? ""} ${cand.title}`).replace(/\s/g, "").includes(want)) s += 0.05;
  }
  // Kısa sorguda (1-2 kelime) uzun/alakasız başlıklar (örn. oyuncak araba "RedBull Sonderedition ...") cezalandırılır.
  const extra = Math.max(0, hay.length - qt.length - 2);
  s -= (qt.length <= 2 ? 0.3 : 0.1) * Math.min(1, extra / (qt.length <= 2 ? 4 : 6));
  return Math.max(0, Math.min(1, s));
}
export const levelOf = (s: number): Level | null => (s >= 0.8 ? "high" : s >= 0.55 ? "medium" : s >= 0.4 ? "low" : null);

// ── Market siteleri: arama sayfası linkleri (her zaman verilir) ve varsa ürün çekici ──
type Store = { id: string; name: string; match: RegExp; search: (q: string) => string; fetch?: (q: Query, f: Fetcher) => Promise<Candidate[]> };

const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'");

async function lidl(q: Query, f: Fetcher): Promise<Candidate[]> {
  const r = await f(`https://www.lidl.de/q/search?q=${encodeURIComponent(q.name)}`, { headers: { "user-agent": "Mozilla/5.0 (compatible; GelirGiderPaneli/1.0)", "accept-language": "de" }, signal: AbortSignal.timeout(7000), next: { revalidate: 60 * 60 * 24 * 7 } } as RequestInit);
  if (!r.ok) return [];
  const html = decode(await r.text());
  const out: Candidate[] = [];
  const re = /"image":"(https:\/\/www\.lidl\.de\/assets\/[^"]+)"[\s\S]{0,6000}?"fullTitle":"([^"]+)"[\s\S]{0,6000}?"productId":(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 12) out.push({ image: m[1], title: m[2], url: `https://www.lidl.de/p/p${m[3]}`, source: "Lidl", score: 0 });
  return out;
}

const STORES: Store[] = [
  { id: "lidl", name: "Lidl", match: /lidl/, search: (q) => `https://www.lidl.de/q/search?q=${q}`, fetch: lidl },
  { id: "rewe", name: "REWE", match: /rewe/, search: (q) => `https://www.rewe.de/suche/produkte?search=${q}` },
  { id: "edeka", name: "EDEKA", match: /edeka|marktkauf|nah\s*&?\s*gut/, search: (q) => `https://www.edeka.de/eh/suche.jsp?q=${q}` },
  { id: "kaufland", name: "Kaufland", match: /kaufland/, search: (q) => `https://www.kaufland.de/s/?search_value=${q}` },
  { id: "aldi", name: "ALDI", match: /aldi/, search: (q) => `https://www.aldi-nord.de/suche.html?query=${q}` },
  { id: "penny", name: "PENNY", match: /penny/, search: (q) => `https://www.penny.de/suche?q=${q}` },
  { id: "netto", name: "Netto", match: /netto/, search: (q) => `https://www.netto-online.de/suche?q=${q}` },
  { id: "dm", name: "dm", match: /\bdm\b|dm-drogerie/, search: (q) => `https://www.dm.de/search?query=${q}` },
  { id: "rossmann", name: "Rossmann", match: /rossmann/, search: (q) => `https://www.rossmann.de/de/search?text=${q}` },
  { id: "migros", name: "Migros", match: /migros/, search: (q) => `https://www.migros.com.tr/arama?q=${q}` },
  { id: "a101", name: "A101", match: /a101/, search: (q) => `https://www.a101.com.tr/arama?k=${q}` },
  { id: "sok", name: "ŞOK", match: /[şs]ok/, search: (q) => `https://www.sokmarket.com.tr/arama?q=${q}` },
  { id: "carrefour", name: "CarrefourSA", match: /carrefour/, search: (q) => `https://www.carrefoursa.com/search?q=${q}` },
];
export const storeFor = (merchant?: string | null) => (merchant ? STORES.find((s) => s.match.test(merchant.toLowerCase())) ?? null : null);

// ── Open Food Facts: .de alt alanı kararlı; world yedek. Aday başına puanlanır. ──
type Off = { code?: string; product_name?: string; product_name_de?: string; generic_name?: string; brands?: string; quantity?: string; stores?: string; image_front_small_url?: string; image_small_url?: string; image_front_url?: string; url?: string };

async function openFoodFacts(q: Query, f: Fetcher, base?: string): Promise<{ cand: Candidate; stores?: string }[]> {
  const bases = base ? [base] : q.currency === "TRY" ? ["https://tr.openfoodfacts.org", "https://world.openfoodfacts.org"] : ["https://de.openfoodfacts.org", "https://world.openfoodfacts.org"];
  const full = [q.brand, q.name].filter(Boolean).join(" ");
  const queries = q.brand ? [full, q.name] : [full]; // marka+ad sonuç vermezse yalnızca ad
  const deadline = Date.now() + 15_000; // route süre sınırı (20 sn) için pay
  for (const terms of queries) {
    for (const b of bases) {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (Date.now() > deadline) return [];
        try {
          const r = await f(`${b}/cgi/search.pl?search_terms=${encodeURIComponent(terms)}&search_simple=1&action=process&json=1&page_size=24&sort_by=unique_scans_n&fields=code,product_name,product_name_de,generic_name,brands,quantity,stores,image_front_small_url,image_small_url,image_front_url,url`, {
            headers: { "user-agent": "GelirGiderPaneli/1.0 (self-hosted personal finance)" }, signal: AbortSignal.timeout(7000), next: { revalidate: 60 * 60 * 24 * 30 },
          } as RequestInit);
          if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) { await new Promise((ok) => setTimeout(ok, 500)); continue; } // 503 "geçici"
          const products = ((await r.json()) as { products?: Off[] }).products ?? [];
          const mapped = products.flatMap((p) => {
            const image = httpUrl(p.image_front_small_url ?? p.image_small_url ?? p.image_front_url);
            const title = p.product_name_de ?? p.product_name ?? p.generic_name;
            if (!image || !title) return [];
            const sc = score(q, { title, brands: p.brands, stores: p.stores, quantity: p.quantity });
            return [{ cand: { image, title: [p.brands?.split(",")[0], title].filter(Boolean).join(" · "), url: httpUrl(p.url) ?? (p.code ? `${b}/product/${encodeURIComponent(p.code)}` : null), source: "Open Food Facts", score: sc }, stores: p.stores }];
          });
          if (mapped.length) return mapped;
          break; // bu alan adında sonuç yok: sıradaki alan adı/sorgu
        } catch { /* zaman aşımı: yeniden dene */ }
      }
    }
  }
  return [];
}

// ── Genel ürünler (muz, süt, ekmek): önce Almanca Wikipedia sayfa görseli, olmazsa Wikimedia Commons araması. Marka/market eşleşmesi değil, "örnek görsel" olarak etiketlenir. ──
async function generic(q: Query, f: Fetcher): Promise<Candidate[]> {
  const ua = { "user-agent": "GelirGiderPaneli/1.0" };
  const names = [q.name, q.name.replace(/(en|n)$/i, "")].filter((n, i, a) => n.length >= 3 && a.indexOf(n) === i);
  for (const n of names) {
    try {
      const r = await f(`https://de.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(n)}&prop=pageimages&piprop=thumbnail&pithumbsize=160&pilicense=any&redirects=1&format=json`, { headers: ua, signal: AbortSignal.timeout(5000), next: { revalidate: 60 * 60 * 24 * 30 } } as RequestInit);
      if (!r.ok) continue;
      const page = Object.values(((await r.json()) as { query?: { pages?: Record<string, { title: string; thumbnail?: { source: string } }> } }).query?.pages ?? {})[0];
      if (page?.thumbnail?.source) return [{ image: page.thumbnail.source, url: `https://de.wikipedia.org/wiki/${encodeURIComponent(page.title)}`, title: page.title, source: "Wikipedia", score: 0.5, generic: true }];
    } catch { /* sıradaki */ }
  }
  try {
    const r = await f(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(`${q.name} Lebensmittel`)}&gsrlimit=2&prop=imageinfo&iiprop=url&iiurlwidth=160&format=json`, { headers: ua, signal: AbortSignal.timeout(5000), next: { revalidate: 60 * 60 * 24 * 30 } } as RequestInit);
    if (!r.ok) return [];
    const pages = Object.values(((await r.json()) as { query?: { pages?: Record<string, { title: string; index?: number; imageinfo?: { thumburl?: string; descriptionurl?: string }[] }> } }).query?.pages ?? {}).sort((x, y) => (x.index ?? 9) - (y.index ?? 9));
    const ii = pages[0]?.imageinfo?.[0];
    if (!ii?.thumburl) return [];
    return [{ image: ii.thumburl, url: ii.descriptionurl ?? null, title: pages[0].title.replace(/^File:/, "").replace(/\.\w+$/, "").replace(/[_-]+/g, " "), source: "Wikimedia Commons", score: 0.42, generic: true }];
  } catch { return []; }
}

export async function findProduct(q0: Query, f: Fetcher = fetch, opts: { offBase?: string } = {}): Promise<Lookup> {
  const store = storeFor(q0.merchant);
  // Ham satırda özel marka geçiyorsa markayı doldur; marka yoksa marketin özel markalarını puanlamaya ekle.
  const q: Query = { ...q0, brand: q0.brand || (q0.raw ? brandInText(q0.raw) : null), ownBrands: ownBrandsFor(store?.id) };
  const encoded = encodeURIComponent([q.brand, q.name].filter(Boolean).join(" "));
  const all: Candidate[] = [];

  // 1) Marketin kendi sitesi (en güvenilir kaynak)
  if (store?.fetch) {
    try { for (const c of await store.fetch(q, f)) all.push({ ...c, score: Math.min(1, score(q, { title: c.title }) + 0.1) }); } catch { /* site engelledi */ }
  }
  // 2) Open Food Facts
  const off = await openFoodFacts(q, f, opts.offBase);
  for (const o of off) all.push(o.cand);
  // 3) Genel örnek görsel: yalnızca markasız ürün ve güvenilir aday yoksa
  if (!q.brand && !all.some((c) => c.score >= 0.8)) all.push(...(await generic(q, f)));

  let ranked = all.filter((c) => levelOf(c.score)).sort((a, b) => b.score - a.score);
  // Ürün görseli bulunamadıysa ama marka biliniyorsa marka sayfasının görseli (logo/ürün) örnek olarak gösterilir (Red Bull gibi bilinen markalar).
  if (!ranked.length && q.brand) {
    const g = await generic({ ...q, name: q.brand, brand: null }, f);
    ranked = g.map((c) => ({ ...c, title: `${q.brand} (marka)`, score: 0.45 }));
  }
  const top = ranked[0];
  return {
    best: top ? { ...top, level: levelOf(top.score)! } : null,
    alternatives: ranked.slice(1, 4),
    storeSearch: store ? { name: store.name, url: store.search(encoded) } : null,
    webSearch: `https://www.google.com/search?tbm=isch&q=${encodeURIComponent([q.brand, q.name, q.merchant].filter(Boolean).join(" "))}`,
  };
}

// ── Barkod (EAN/UPC) ile kesin eşleşme ──
export async function findByBarcode(ean: string, f: Fetcher = fetch, base?: string): Promise<Candidate | null> {
  if (!/^\d{8,14}$/.test(ean)) return null;
  for (const b of base ? [base] : ["https://world.openfoodfacts.org", "https://de.openfoodfacts.org"]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await f(`${b}/api/v2/product/${ean}.json?fields=code,product_name,product_name_de,brands,image_front_small_url,image_small_url,image_front_url`, { headers: { "user-agent": "GelirGiderPaneli/1.0" }, signal: AbortSignal.timeout(7000), next: { revalidate: 60 * 60 * 24 * 30 } } as RequestInit);
        if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) { await new Promise((ok) => setTimeout(ok, 400)); continue; }
        const j = (await r.json()) as { status?: number; product?: Off };
        const p = j.product;
        const image = httpUrl(p?.image_front_small_url ?? p?.image_small_url ?? p?.image_front_url);
        const title = p?.product_name_de ?? p?.product_name;
        if (!j.status || !p || !image || !title) return null;
        return { image, title: [p.brands?.split(",")[0], title].filter(Boolean).join(" · "), url: `${b}/product/${ean}`, source: "Barkod", score: 1 };
      } catch { /* yeniden dene */ }
    }
  }
  return null;
}

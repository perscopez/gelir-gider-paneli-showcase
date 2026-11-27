"use client";
/* eslint-disable @next/next/no-img-element -- dış kaynaklı küçük ürün görselleri, next/image optimizasyonu gerekmez */

import { useEffect, useState, type ReactNode } from "react";
import type { ReceiptLabels as Labels } from "@/lib/receipt-labels";
import { Check, ImageOff, Percent, Recycle, Search, ShoppingBag, Store, Tag, TriangleAlert } from "lucide-react";
import { lineKind } from "@/lib/line-kind";
import { DealChip } from "@/components/deal-card";
import type { ItemVerdict } from "@/lib/price-verdict";

export type ReceiptLine = {
  line_no: number; name: string; product: string | null; brand: string | null; quantity: number; unit: string | null;
  pack_amount: number | null; pack_unit: string | null; unit_price: number | null; line_total: number; category: string;
  base_unit: string | null; price_per_base: number | null; currency: string; merchant?: string | null;
  verdict?: ItemVerdict; // ürünün kendi fiyat geçmişine göre ucuz/normal/pahalı (sunucuda hesaplanır)
};
type Cand = { image: string; url: string | null; title: string; source: string; score: number; generic?: boolean; learned?: boolean };
type Found = { best: (Cand & { level: "high" | "medium" | "low" }) | null; alternatives: Cand[]; storeSearch: { name: string; url: string } | null; webSearch: string };

const cache = new Map<string, Promise<Found | null>>();
// Aynı anda en çok 3 arama: sayfada çok kalem olsa da dış servislere yığılma olmaz.
let running = 0;
const waiting: (() => void)[] = [];
const slot = async () => { if (running >= 3) await new Promise<void>((ok) => waiting.push(ok)); running++; };
const release = () => { running--; waiting.shift()?.(); };
function lookup(l: ReceiptLine): Promise<Found | null> {
  const name = l.product ?? l.name;
  const key = [l.merchant, l.brand, name, l.name, l.pack_amount, l.pack_unit].join("|");
  let p = cache.get(key);
  if (!p) {
    const qs = new URLSearchParams({ name, raw: l.name, brand: l.brand ?? "", merchant: l.merchant ?? "", category: l.category, currency: l.currency });
    if (l.pack_amount && l.pack_unit) { qs.set("pack", String(l.pack_amount)); qs.set("unit", l.pack_unit); }
    p = slot().then(() => fetch(`/api/product?${qs}`).then((r) => (r.ok ? (r.json() as Promise<Found>) : null)).catch(() => null).finally(release));
    cache.set(key, p);
  }
  return p;
}

// Kullanıcının seçtiği/düzelttiği görsel bu tarayıcıda hatırlanır (ürün adı + marka başına).
const pickKey = (l: ReceiptLine) => `pimg:${l.brand ?? ""}|${l.product ?? l.name}`.toLowerCase();
const readPick = (l: ReceiptLine): Cand | null => { try { const v = localStorage.getItem(pickKey(l)); return v ? (JSON.parse(v) as Cand) : null; } catch { return null; } };
const writePick = (l: ReceiptLine, c: Cand | null, barcode?: string) => {
  try { if (c) localStorage.setItem(pickKey(l), JSON.stringify(c)); else localStorage.removeItem(pickKey(l)); } catch { /* özel pencere */ }
  // Kalıcı öğrenme (0003 çalıştırılmışsa): aynı kalem sonraki fişlerde otomatik doğru gelir.
  const base = { raw: l.name, merchant: l.merchant ?? "" };
  if (c) fetch("/api/product", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...base, product: l.product, brand: l.brand, title: c.title, image: c.image, url: c.url, source: c.source, barcode: barcode ?? null }) }).catch(() => {});
  else fetch(`/api/product?${new URLSearchParams(base)}`, { method: "DELETE" }).catch(() => {});
  cache.delete([l.merchant, l.brand, l.product ?? l.name, l.name, l.pack_amount, l.pack_unit].join("|"));
};


function BarcodeBox({ onFound, labels }: { onFound: (c: Cand, ean: string) => void; labels: Labels }) {
  const [ean, setEan] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "none">("idle");
  const [scan, setScan] = useState(false);
  const canScan = typeof window !== "undefined" && "BarcodeDetector" in window;
  async function go(code: string) {
    const digits = code.replace(/\D/g, "");
    if (digits.length < 8) return;
    setState("busy");
    const r = await fetch(`/api/product?barcode=${digits}`).then((x) => (x.ok ? (x.json() as Promise<Found>) : null)).catch(() => null);
    if (r?.best) onFound(r.best, digits); else setState("none");
  }
  useEffect(() => {
    if (!scan) return;
    let stop = false;
    let stream: MediaStream | null = null;
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Detector = (window as any).BarcodeDetector;
        const det = new Detector({ formats: ["ean_13", "ean_8", "upc_a"] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const v = document.getElementById("barcode-video") as HTMLVideoElement | null;
        if (!v) return;
        v.srcObject = stream; await v.play();
        while (!stop) {
          const found = await det.detect(v).catch(() => []);
          if (found[0]?.rawValue) { setScan(false); setEan(found[0].rawValue); go(found[0].rawValue); return; }
          await new Promise((ok) => setTimeout(ok, 300));
        }
      } catch { setScan(false); }
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan]);
  return (
    <div className="mt-2 border-t pt-2">
      <div className="mb-1 font-medium">{labels.barcode}</div>
      <div className="flex gap-1">
        <input value={ean} onChange={(e) => { setEan(e.target.value); setState("idle"); }} inputMode="numeric" placeholder="4008452027602" className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs" />
        <button type="button" onClick={() => go(ean)} disabled={state === "busy"} className="rounded-md border px-2 text-xs hover:bg-accent">{state === "busy" ? "…" : "OK"}</button>
        {canScan ? <button type="button" onClick={() => setScan((s) => !s)} className="rounded-md border px-2 text-xs hover:bg-accent" aria-label={labels.scan}>📷</button> : null}
      </div>
      {scan ? <video id="barcode-video" muted playsInline className="mt-1.5 w-full rounded-md bg-black" /> : null}
      {state === "none" ? <div className="mt-1 text-amber-600 dark:text-amber-400">{labels.barcodeNone}</div> : null}
    </div>
  );
}

function Thumb({ line, labels, onFound }: { line: ReceiptLine; labels: Labels; onFound?: (f: Found | null) => void }) {
  const [f, setF] = useState<Found | null | undefined>(undefined);
  const [picked, setPicked] = useState<Cand | null>(null);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const kind = lineKind(line);
  const skip = kind !== "product";
  useEffect(() => {
    if (skip) return;
    let live = true;
    lookup(line).then((r) => { if (live) { setF(r); setPicked(readPick(line)); onFound?.(r); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line, skip]);
  if (skip) {
    const Icon = kind === "discount" ? Percent : kind === "deposit" ? Recycle : kind === "bag" ? ShoppingBag : Tag;
    const tone = kind === "discount" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground";
    return (
      <div className="flex w-14 shrink-0 flex-col items-center gap-1">
        <div className={`flex size-12 items-center justify-center rounded-lg border ${tone}`}><Icon className="size-5" aria-hidden /></div>
        <span className="text-[10px] leading-none text-muted-foreground">{labels.kind[kind]}</span>
      </div>
    );
  }

  const shown: (Cand & { level?: "high" | "medium" | "low" }) | null = picked ? { ...picked, level: "high" } : f?.best && !broken.has(f.best.image) ? f.best : null;
  const alts = [...(picked && f?.best ? [f.best] : []), ...(f?.alternatives ?? [])].filter((c) => !broken.has(c.image) && c.image !== shown?.image).slice(0, 4);
  const tag = !shown ? null : picked || (shown as Cand).learned ? labels.match.picked : shown.generic ? labels.match.generic : labels.match[shown.level ?? "low"];
  const tone = !shown ? "" : picked || (shown as Cand).learned || (shown.level === "high" && !shown.generic) ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400";

  return (
    <div className="flex w-14 shrink-0 flex-col items-center gap-1">
      <a href={shown?.url ?? f?.storeSearch?.url ?? f?.webSearch ?? undefined} target="_blank" rel="noreferrer" title={shown ? `${shown.title} (${shown.source}, %${Math.round(shown.score * 100)})` : labels.noImage}
        className="flex size-12 items-center justify-center overflow-hidden rounded-lg border bg-muted text-muted-foreground">
        {shown ? (
          <img src={shown.image} alt={shown.title} loading="lazy" onError={() => setBroken((b) => new Set(b).add(shown.image))} className="size-full object-contain" />
        ) : f === undefined ? <span className="size-4 animate-pulse rounded bg-muted-foreground/20" /> : <ImageOff className="size-4" aria-label={labels.noImage} />}
      </a>
      {shown ? (
        <button type="button" onClick={() => setOpen((o) => !o)} className={`flex items-center gap-0.5 text-[10px] leading-none ${tone}`} title={labels.wrongMatch} aria-expanded={open}>
          {tone.startsWith("text-emerald") ? <Check className="size-2.5" /> : <TriangleAlert className="size-2.5" />}{tag}
        </button>
      ) : null}
      {open ? (
        <div className="absolute z-10 mt-14 w-60 rounded-lg border bg-popover p-2 text-xs shadow-md">
          {shown ? <div className="mb-1.5 text-muted-foreground">{shown.source}: {shown.title}</div> : null}
          <div className="mb-1 font-medium">{labels.wrongMatch}</div>
          <div className="flex flex-wrap gap-1.5">
            {alts.map((c) => (
                  <button key={c.image} type="button" title={`${c.title} (${c.source})`} onClick={() => { writePick(line, c); setPicked(c); setOpen(false); }} className="size-11 overflow-hidden rounded border bg-muted hover:ring-2 hover:ring-ring">
                <img src={c.image} alt={c.title} loading="lazy" onError={() => setBroken((b) => new Set(b).add(c.image))} className="size-full object-contain" />
              </button>
            ))}
          </div>
          <BarcodeBox onFound={(c, ean) => { writePick(line, c, ean); setPicked(c); setOpen(false); }} labels={labels} />
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {f?.storeSearch ? <a href={f.storeSearch.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline"><Store className="size-3" />{f.storeSearch.name}</a> : null}
            <a href={f?.webSearch} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline"><Search className="size-3" />{labels.find}</a>
            {picked ? <button type="button" className="underline" onClick={() => { writePick(line, null); setPicked(null); setOpen(false); }}>↺</button> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Marketin sitesine tıklanabilir bağlantı: Lidl gibi ürünü doğrudan bulabildiğimiz yerde ürün sayfası, diğerlerinde marketin arama sayfası.
function StoreLink({ found, labels }: { found: Found | null; labels: Labels }) {
  if (!found?.storeSearch) return null;
  const direct = found.best && found.best.source === found.storeSearch.name && found.best.url ? found.best.url : null;
  return (
    <a href={direct ?? found.storeSearch.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary hover:bg-primary/20" title={found.storeSearch.url}>
      <Store className="size-3" />{found.storeSearch.name} {direct ? labels.storeProduct : labels.storeFind} ↗
    </a>
  );
}

// Ucuz / normal / pahalı rozeti: kendi geçmiş alımlarının medyanına göre. Üzerine gelince medyan, alım sayısı ve en ucuz mağaza.
function VerdictBadge({ v, unit, money, labels, cur }: { v: ItemVerdict; unit: string | null; money: (n: number, c: string) => string; labels: Labels; cur: string }) {
  if (v.level === "new" || v.pct === null || v.median === null) return null;
  const tone = v.level === "cheap" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : v.level === "expensive" ? "bg-red-500/15 text-red-700 dark:text-red-400" : "bg-muted text-muted-foreground";
  const pct = Math.round(v.pct * 100);
  const tip = `${labels.verdict.avg}: ${money(v.median, cur)}/${unit === "pcs" ? "pc" : unit} · ${v.n} ${labels.verdict.times}${v.cheapestStore && v.level !== "cheap" ? ` · ${labels.verdict.cheapest}: ${v.cheapestStore}` : ""}`;
  return <span title={tip} className={`rounded px-1.5 py-0.5 font-medium ${tone}`}>{labels.verdict[v.level]} {pct > 0 ? "+" : ""}{pct}%</span>;
}

function Row({ it, money, unitLabel, labels, locale }: { it: ReceiptLine; money: (n: number, c: string) => string; unitLabel: (u: string | null) => string | null; labels: Labels; locale: "tr" | "en" }) {
  const [found, setFound] = useState<Found | null>(null);
  return (
    <li className="relative flex items-start gap-3 py-2.5">
      <Thumb line={it} labels={labels} onFound={setFound} />
      <div className="min-w-0 flex-1">
        <div className="font-medium leading-snug">{it.product ?? it.name}{it.brand ? <span className="font-normal text-muted-foreground"> · {it.brand}</span> : null}</div>
        {it.product && it.product !== it.name ? <div className="truncate text-xs text-muted-foreground" title={it.name}>{it.name}</div> : null}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{Number(it.quantity) || 1}{it.unit ? ` ${unitLabel(it.unit)}` : ""}{it.pack_amount ? ` (${Number(it.pack_amount)} ${it.pack_unit ?? ""})` : ""}</span>
          {it.unit_price != null ? <span>× {money(Number(it.unit_price), it.currency)}</span> : null}
          {it.price_per_base && it.base_unit ? <span>· {money(Number(it.price_per_base), it.currency)}/{unitLabel(it.base_unit)}</span> : null}
          {it.verdict ? <VerdictBadge v={it.verdict} unit={it.base_unit} money={money} labels={labels} cur={it.currency} /> : null}
          <span className="rounded bg-muted px-1.5">{it.category}</span>
          <StoreLink found={found} labels={labels} />
          {lineKind(it) === "product" && it.line_total > 0 ? <DealChip q={{ name: it.product ?? it.name, brand: it.brand, ppb: it.price_per_base ? Number(it.price_per_base) : null, unit: it.base_unit }} locale={locale} /> : null}
        </div>
      </div>
      <div className={`tnum shrink-0 font-medium ${it.line_total < 0 ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{money(Number(it.line_total), it.currency)}</div>
    </li>
  );
}

export function ReceiptItems({ items, locale, labels }: { items: ReceiptLine[]; locale: "tr" | "en"; labels: Labels }) {
  const money = (n: number, cur: string) => new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-GB", { style: "currency", currency: cur }).format(n);
  const unitLabel = (u: string | null) => (u === "pcs" ? (locale === "tr" ? "adet" : "pc") : u);
  return (
    <ul className="divide-y text-sm">
      {items.map((it) => <Row key={it.line_no} it={it} money={money} unitLabel={unitLabel} labels={labels} locale={locale} />)}
    </ul>
  );
}

// Açılınca içerik yüklenir: kapalı alışverişler için hiç ürün araması yapılmaz.
export function TripDetails({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  const [opened, setOpened] = useState(false);
  return (
    <details className="group rounded-lg border">
      <summary onClick={() => setOpened(true)} className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm marker:hidden">{summary}</summary>
      <div className="border-t px-4 pb-2">{opened ? children : null}</div>
    </details>
  );
}

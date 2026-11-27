"use client";
/* eslint-disable @next/next/no-img-element -- dış kaynaklı küçük fırsat görselleri */

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { DealResult } from "@/lib/kaufda";

const tl = (locale: string, tr: string, en: string) => (locale === "tr" ? tr : en);

let running = 0;
const waiting: (() => void)[] = [];
const slot = async () => { if (running >= 3) await new Promise<void>((ok) => waiting.push(ok)); running++; };
const release = () => { running--; waiting.shift()?.(); };
const cache = new Map<string, Promise<DealResult>>();

export function loadDeals(q: { name: string; brand?: string | null; ppb?: number | null; unit?: string | null }): Promise<DealResult> {
  const qs = new URLSearchParams({ name: q.name, brand: q.brand ?? "", unit: q.unit ?? "" });
  if (q.ppb) qs.set("ppb", String(q.ppb));
  const key = qs.toString();
  let p = cache.get(key);
  if (!p) {
    p = slot().then(() => fetch(`/api/deals?${qs}`).then((r) => (r.ok ? (r.json() as Promise<DealResult>) : { url: null, offers: [] })).catch(() => ({ url: null, offers: [] }) as DealResult).finally(release));
    cache.set(key, p);
  }
  return p;
}

type Q = { name: string; brand?: string | null; ppb?: number | null; unit?: string | null; ppbAll?: number | null };
const eur = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "EUR" }).format(n);
const unitName = (u: string) => (u === "pcs" ? "adet" : u);
const amountText = (a: number, u: string) => (u === "kg" && a < 1 ? `${Math.round(a * 1000)} g` : u === "l" && a < 1 ? `${Math.round(a * 1000)} ml` : `${+a.toFixed(2)} ${unitName(u)}`);

// Teklifin miktarı (fiyat ÷ birim fiyat) için senin normalde ödeyeceğin tutar ve benzer ürünlerin ortalaması.
export function normalFor(o: { price: number; perBase: { value: number; unit: string } | null }, q: Q) {
  if (!o.perBase || !q.unit || o.perBase.unit !== q.unit || !o.perBase.value) return null;
  const amount = o.price / o.perBase.value;
  const mine = q.ppb ? { perUnit: q.ppb, total: q.ppb * amount } : null;
  const all = q.ppbAll ? { perUnit: q.ppbAll, total: q.ppbAll * amount } : null;
  return { amount, unit: o.perBase.unit, mine, all: all && mine && Math.abs(all.perUnit - mine.perUnit) / mine.perUnit < 0.05 ? null : all };
}

const fmtDate = (iso: string, locale: string) => new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", { day: "numeric", month: "short" }).format(new Date(iso));

// Satır içi küçük rozet: en iyi fırsat (örn. "REWE 0,99 € · −27%"), tıklayınca KaufDA sayfası.
export function DealChip({ q, locale }: { q: Q; locale: "tr" | "en" }) {
  const [r, setR] = useState<DealResult | null>(null);
  useEffect(() => {
    let live = true;
    loadDeals(q).then((x) => { if (live) setR(x); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.name, q.brand, q.ppb, q.unit]);
  const best = r?.offers[0];
  if (!best || !r?.url) return null;
  const cheaper = (best.saving ?? 0) >= 0.1;
  const nf = normalFor(best, q);
  const normalText = nf?.mine ? `${amountText(nf.amount, nf.unit)} için normalde ≈ ${eur(nf.mine.total)}` : "";
  return (
    <a href={r.url} target="_blank" rel="noreferrer" title={`${best.retailer}: ${best.title} · ${fmtDate(best.validFrom, locale)}–${fmtDate(best.validUntil, locale)} (KaufDA)${normalText ? ` · ${normalText}` : ""}`}
      className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-medium ${cheaper ? "bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-300" : "bg-muted text-foreground hover:bg-accent"}`}>
      🏷 {best.retailer} {best.priceText}{nf?.mine ? ` (${locale === "tr" ? "normal" : "usual"} ≈ ${eur(nf.mine.total)})` : ""}{cheaper ? ` · −${Math.round((best.saving ?? 0) * 100)}%` : ""} <ExternalLink className="size-3" />
    </a>
  );
}

export function DealCard({ q, labels, locale }: {
  q: Q & { brand: string | null; count: number; lastPaid: string | null };
  labels: { none: string; saving: string; until: string; bought: string; open: string; normal: string; avgMine: string; avgAll: string }; locale: "tr" | "en";
}) {
  const [r, setR] = useState<DealResult | null>(null);
  useEffect(() => {
    let live = true;
    loadDeals(q).then((x) => { if (live) setR(x); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.name, q.brand, q.ppb, q.unit]);
  if (r && !r.offers.length) return null; // fırsat yoksa kart gösterilmez
  return (
    <li className="rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{q.name}{q.brand ? <span className="font-normal text-muted-foreground"> · {q.brand}</span> : null}</span>
        <span className="text-xs text-muted-foreground">{q.count}× {labels.bought}{q.lastPaid ? ` · ${q.lastPaid}` : ""}</span>
      </div>
      {r === null ? <div className="mt-3 h-10 animate-pulse rounded bg-muted" /> : (
        <ul className="mt-2 divide-y text-sm">
          {r.offers.slice(0, 3).map((o) => (
            <li key={`${o.retailer}${o.title}${o.price}`} className="flex items-center gap-3 py-2">
              {o.image ? (
                <a href={o.imageLarge ?? o.image} target="_blank" rel="noreferrer" title={tl(locale, "Afişi büyüt", "Enlarge flyer")} className="shrink-0">
                  <img src={o.image} alt={o.title} loading="lazy" className="size-24 rounded-md border bg-white object-contain sm:size-28" />
                </a>
              ) : <div className="size-12 shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{o.retailer} · {o.title}</div>
                <div className="truncate text-xs text-muted-foreground">{o.note ? `${o.note} · ` : ""}{labels.until} {fmtDate(o.validUntil, locale)}{o.perBase ? ` · ${o.perBase.value.toFixed(2)} €/${o.perBase.unit === "pcs" ? "adet" : o.perBase.unit}` : ""}</div>
                {(() => {
                  const nf = normalFor(o, q);
                  if (!nf?.mine) return null;
                  // Karar: aynı miktar için normalde ödeyeceğin tutarla teklif fiyatı karşılaştırılır (miktar = fiyat ÷ birim fiyat).
                  const diff = nf.mine.total - o.price;
                  const pct = nf.mine.total > 0 ? diff / nf.mine.total : 0;
                  const same = Math.abs(pct) < 0.05;
                  const tone = same ? "text-muted-foreground" : pct > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
                  const verdict = same
                    ? `${amountText(nf.amount, nf.unit)}: normal fiyata yakın`
                    : pct > 0
                      ? `${amountText(nf.amount, nf.unit)} için normalde ${eur(nf.mine.total)}, şimdi ${eur(o.price)}: ${eur(diff)} tasarruf (%${Math.round(pct * 100)} ucuz)`
                      : `${amountText(nf.amount, nf.unit)} için normalde ${eur(nf.mine.total)}, şimdi ${eur(o.price)}: ${eur(-diff)} fazla (%${Math.round(-pct * 100)} pahalı)`;
                  return (
                    <div className="mt-0.5 text-xs">
                      <span className={`font-medium ${tone}`}>{verdict}</span>
                      <span className="text-muted-foreground">{` · ${labels.avgMine}: ${eur(nf.mine.perUnit)}/${unitName(nf.unit)} → ${o.perBase ? `${eur(o.perBase.value)}/${unitName(o.perBase.unit)}` : ""}`}</span>
                      {nf.all ? <span className="text-muted-foreground">{` · ${labels.avgAll}: ${eur(nf.all.perUnit)}/${unitName(nf.unit)}`}</span> : null}
                    </div>
                  );
                })()}
              </div>
              <div className="text-right">
                <div className="tnum font-semibold">{o.priceText}</div>
                {o.saving !== undefined && o.saving >= 0.05 ? <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400">−{Math.round(o.saving * 100)}% {labels.saving}</div> : null}
                {o.saving !== undefined && o.saving <= -0.05 ? <div className="text-xs font-medium text-red-600 dark:text-red-400">+{Math.round(-o.saving * 100)}% pahalı</div> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {r?.url ? <a href={r.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground underline"><ExternalLink className="size-3" />{labels.open}</a> : null}
    </li>
  );
}

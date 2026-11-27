import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { lineKind } from "@/lib/line-kind";
import { findByBarcode, findProduct, httpUrl, storeFor } from "@/lib/product-lookup";
import { aliasKey, merchantKey } from "@/lib/alias";

export const maxDuration = 20;

const clean = (s: string | null, n: number) => (s ?? "").replace(/[^\p{L}\p{N} .&'%,!-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, n);
const empty = { best: null, alternatives: [], storeSearch: null, webSearch: "" };

// Fiş kalemi için ürün fotoğrafı + link. Sıra: 1) senin öğrettiğin eşleşme (product_aliases), 2) market sitesi, 3) Open Food Facts, 4) genel örnek görsel.
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return new NextResponse("unauthorized", { status: 401 });
  const u = new URL(req.url);

  const barcode = (u.searchParams.get("barcode") ?? "").replace(/\D/g, "");
  if (barcode) {
    const c = await findByBarcode(barcode, fetch, process.env.OFF_API_BASE);
    return NextResponse.json({ ...empty, best: c ? { ...c, level: "high" } : null });
  }

  const name = clean(u.searchParams.get("name"), 80);
  if (!name) return NextResponse.json(empty);
  const raw = clean(u.searchParams.get("raw"), 120) || name;
  const merchant = clean(u.searchParams.get("merchant"), 60) || null;
  const category = clean(u.searchParams.get("category"), 40);
  if (lineKind({ name: raw, product: name, category, line_total: 1 }) !== "product") return NextResponse.json(empty); // indirim/depozito/poşet: arama yok

  // 1) Öğrenilmiş eşleşme (tablo yoksa sessizce atlanır)
  const { data: al } = await supabase.from("product_aliases").select("title,image,url,source,barcode").eq("merchant", merchantKey(merchant)).eq("alias", aliasKey(raw)).maybeSingle();
  const store = storeFor(merchant);
  if (al?.image) {
    return NextResponse.json({
      best: { image: al.image, url: al.url, title: al.title ?? name, source: al.source ?? "Eşleştirmen", score: 1, level: "high", learned: true },
      alternatives: [], storeSearch: store ? { name: store.name, url: store.search(encodeURIComponent(name)) } : null,
      webSearch: `https://www.google.com/search?tbm=isch&q=${encodeURIComponent([name, merchant].filter(Boolean).join(" "))}`,
    }, { headers: { "Cache-Control": "private, max-age=60" } });
  }

  const pack = Number(u.searchParams.get("pack"));
  const result = await findProduct(
    { raw, name, brand: clean(u.searchParams.get("brand"), 40) || null, merchant, packAmount: pack > 0 ? pack : null, packUnit: clean(u.searchParams.get("unit"), 6) || null, category: category || null, currency: clean(u.searchParams.get("currency"), 3) || null },
    fetch, { offBase: process.env.OFF_API_BASE },
  );
  const ttl = result.best && result.best.level !== "low" ? 60 * 60 * 24 * 7 : 60 * 10;
  return NextResponse.json(result, { headers: { "Cache-Control": `private, max-age=${ttl}` } });
}

// Seçimi kaydet (öğren) ya da sil.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return new NextResponse("unauthorized", { status: 401 });
  const b = (await req.json().catch(() => null)) as Record<string, string | null> | null;
  if (!b?.raw || !b.image) return NextResponse.json({ error: "eksik alan" }, { status: 400 });
  const image = httpUrl(b.image.slice(0, 600));
  if (!image) return NextResponse.json({ error: "geçersiz görsel adresi" }, { status: 400 });
  const row = {
    merchant: merchantKey(b.merchant), alias: aliasKey(b.raw), product: b.product?.slice(0, 80) ?? null, brand: b.brand?.slice(0, 40) ?? null,
    title: b.title?.slice(0, 160) ?? null, image, url: httpUrl(b.url?.slice(0, 600)), source: b.source?.slice(0, 40) ?? null, barcode: b.barcode?.slice(0, 14) ?? null, updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("product_aliases").upsert({ ...row, user_id: data.user.id }, { onConflict: "user_id,merchant,alias" });
  if (error) return NextResponse.json({ error: /product_aliases/.test(error.message) ? "0003_product_aliases.sql çalıştırılmamış" : error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return new NextResponse("unauthorized", { status: 401 });
  const u = new URL(req.url);
  const raw = clean(u.searchParams.get("raw"), 120);
  if (!raw) return NextResponse.json({ error: "eksik alan" }, { status: 400 });
  await supabase.from("product_aliases").delete().eq("merchant", merchantKey(clean(u.searchParams.get("merchant"), 60))).eq("alias", aliasKey(raw));
  return NextResponse.json({ ok: true });
}

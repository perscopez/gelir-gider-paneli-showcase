import { NextResponse } from "next/server";
import { z } from "zod";
import { bearer, safeEqual } from "@/lib/auth-secret";
import { mergeIntoReceiptTxn, recordQuickTxn } from "@/lib/ingest";
import { todayISO } from "@/lib/date";
import { parseMoney } from "@/lib/parse";
import { notify } from "@/lib/notify";
import { fmt } from "@/lib/money";
import { adminClient, ownerId } from "@/lib/supabase/admin";

// iPhone Kısayollar > Otomasyon > İşlem (Apple Pay) → "URL İçeriğini Al" ile buraya POST.
// Başlık: Authorization: Bearer <INGEST_SECRET>
// Gövde (JSON veya form): { amount: "€12,50" (biçimli metin olabilir), merchant, card: "Fabrikam Mastercard", id? }
const Body = z.object({
  amount: z.union([z.string(), z.number()]),
  merchant: z.string().optional(),
  card: z.string().optional(), // Wallet'taki kart adı; hesap adıyla ortak kelimeden eşleşir
  currency: z.enum(["EUR", "TRY"]).optional(),
  id: z.string().optional(), // aynı işlemi iki kez yazmamak için
  kind: z.enum(["income", "expense"]).default("expense"),
});

async function readBody(req: Request): Promise<unknown> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return req.json().catch(() => null);
  const form = await req.formData().catch(() => null);
  return form ? Object.fromEntries(form.entries()) : null;
}

export async function POST(req: Request) {
  if (!safeEqual(bearer(req), process.env.INGEST_SECRET)) return new NextResponse("forbidden", { status: 403 });
  const raw = await readBody(req);
  const parsed = Body.safeParse(raw);
  // Teşhis için (tutar/işyeri değerleri yazılmaz): hangi alanlar geldi, tutar dolu muydu.
  const shape = (o: unknown) => (o && typeof o === "object" ? Object.fromEntries(Object.entries(o as Record<string, unknown>).map(([k, v]) => [k, v === "" || v == null ? "boş" : `${typeof v}(${String(v).length})`])) : String(o));
  if (!parsed.success) {
    console.warn("[ingest] 400 geçersiz gövde", JSON.stringify({ type: req.headers.get("content-type"), shape: shape(raw) }));
    return NextResponse.json({ error: "Geçersiz gövde", details: parsed.error.flatten() }, { status: 400 });
  }
  const b = parsed.data;
  const money = parseMoney(b.amount);
  if (!money) {
    console.warn("[ingest] 400 tutar okunamadı", JSON.stringify({ shape: shape(raw) }));
    return NextResponse.json({ error: `Tutar okunamadı: "${b.amount}"` }, { status: 400 });
  }
  const merchant = b.merchant?.trim() || undefined;
  try {
    // Wallet otomasyonu bazen aynı ödeme için iki kez tetiklenir: aynı satıcı + tutar son 2 dakikada varsa tekrar kaydetme.
    if (merchant && !b.id) {
      const { data: dupe } = await adminClient().from("transactions").select("id").eq("user_id", ownerId()).eq("source", "apple_pay")
        .eq("merchant", merchant).eq("amount", money.amount).gte("created_at", new Date(Date.now() - 120_000).toISOString()).limit(1);
      if (dupe?.length) return NextResponse.json({ ok: true, duplicate: true });
    }
    // Aynı olay kimliği zaten işlendiyse (kısayol yeniden denedi): hiçbir şey yapma.
    if (b.id) {
      const { data: seen } = await adminClient().from("transactions").select("id").eq("user_id", ownerId()).eq("external_id", `ap:${b.id}`).limit(1);
      if (seen?.length) return NextResponse.json({ ok: true, duplicate: true });
    }
    // Fiş Telegram'dan önce geldiyse (nakit hesaba yazılmıştı): çift kayıt açma, o işlemi karta taşı.
    const merged = b.kind === "expense" ? await mergeIntoReceiptTxn({ amount: money.amount, currency: b.currency ?? money.currency, merchant, accountHint: b.card, date: todayISO(), externalId: b.id ? `ap:${b.id}` : undefined }) : null;
    if (merged) {
      await notify("Apple Pay", `${merchant ?? merged.merchant ?? "?"}: ${fmt(merged.amount, merged.currency, "tr")} → ${merged.accountName} (Telegram fişiyle birleştirildi)`);
      return NextResponse.json({ ok: true, merged: true, id: merged.id, account: merged.accountName });
    }
    const r = await recordQuickTxn({
      kind: b.kind, amount: money.amount, currency: b.currency ?? money.currency, merchant,
      accountHint: b.card, source: "apple_pay", externalId: b.id ? `ap:${b.id}` : undefined,
    });
    await notify("Apple Pay", `${merchant ?? "?"}: ${fmt(r.amount, r.currency, "tr")} → ${r.accountName}${r.categorized ? "" : " (kategorisiz)"}`);
    return NextResponse.json({ ok: true, id: r.id, account: r.accountName, amount: r.amount, currency: r.currency, categorized: r.categorized });
  } catch (e) {
    const msg = (e as Error).message;
    // unique(external_id) çakışması = zaten kaydedilmiş
    if (msg.includes("transactions_external_uidx") || msg.includes("duplicate key")) return NextResponse.json({ ok: true, duplicate: true });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

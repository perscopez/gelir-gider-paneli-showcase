"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { rateForDate } from "@/lib/fx";
import { run } from "@/lib/action";
import { amountOrThrow, dateOrToday, text, toNum } from "@/lib/validate";


export async function addTransaction(formData: FormData) {
  return run(async () => {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) throw new Error("Oturum bitti, tekrar giriş yap.");

    const kind = String(formData.get("kind")) as "income" | "expense" | "transfer";
    const accountId = String(formData.get("account_id"));
    const amount = amountOrThrow(formData.get("amount"));
    if (!["income", "expense", "transfer"].includes(kind)) throw new Error("Geçersiz tür.");

    const { data: acc } = await supabase.from("accounts").select("currency").eq("id", accountId).single();
    if (!acc) throw new Error("Hesap bulunamadı.");
    const occurredOn = dateOrToday(formData.get("occurred_on"));
    const rate = await rateForDate(supabase, occurredOn); // işlem gününün kuru (geçmiş tarihli girişte güncel kur değil)
    if (!rate) throw new Error("Kur bulunamadı. Önce /api/cron/daily çağrılmalı (README adım 5).");

    let toAccountId: string | null = null;
    let toAmount: number | null = null;
    if (kind === "transfer") {
      toAccountId = String(formData.get("to_account_id") || "");
      if (!toAccountId) throw new Error("Transfer için hedef hesap seç.");
      if (toAccountId === accountId) throw new Error("Hedef hesap farklı olmalı.");
      const { data: to } = await supabase.from("accounts").select("currency").eq("id", toAccountId).single();
      if (!to) throw new Error("Hedef hesap bulunamadı.");
      const given = toNum(formData.get("to_amount"));
      toAmount = given > 0 ? given
        : to.currency === acc.currency ? amount
        : acc.currency === "EUR" ? amount * rate : amount / rate;
      toAmount = Math.round(toAmount * 100) / 100;
    }

    const id = crypto.randomUUID();
    let receiptPath: string | null = null;
    const file = formData.get("receipt");
    if (file instanceof File && file.size > 0) {
      if (file.size > 10 * 1024 * 1024) throw new Error("Fiş 10 MB'dan büyük.");
      receiptPath = `${auth.user.id}/${id}-${file.name.replace(/[^\w.-]/g, "_")}`;
      const up = await supabase.storage.from("receipts").upload(receiptPath, file, { contentType: file.type });
      if (up.error) throw new Error(`Fiş yüklenemedi: ${up.error.message}`);
    }

    const { error } = await supabase.from("transactions").insert({
      id,
      account_id: accountId,
      to_account_id: toAccountId,
      to_amount: toAmount,
      category_id: kind === "transfer" ? null : String(formData.get("category_id") || "") || null,
      kind,
      amount,
      currency: acc.currency,
      eur_try_rate: rate,
      occurred_on: occurredOn,
      merchant: text(formData.get("merchant")) || null,
      note: text(formData.get("note"), 300) || null,
      receipt_path: receiptPath,
      source: "manual",
    });
    if (error) throw new Error(error.message);
  });
}

export async function updateTransaction(formData: FormData) {
  return run(async () => {
    const amount = amountOrThrow(formData.get("amount"));
    const supabase = await createClient();
    const id = String(formData.get("id"));
    const occurredOn = dateOrToday(formData.get("occurred_on"));
    // Tarih değiştiyse kur da yeni tarihe göre yenilenir (aksi halde eski günün kuru kalırdı).
    const { data: cur } = await supabase.from("transactions").select("occurred_on").eq("id", id).maybeSingle();
    const rate = cur && cur.occurred_on !== occurredOn ? await rateForDate(supabase, occurredOn) : 0;
    const { error } = await supabase.from("transactions").update({
      amount,
      category_id: String(formData.get("category_id") || "") || null,
      merchant: text(formData.get("merchant")) || null,
      note: text(formData.get("note"), 300) || null,
      occurred_on: occurredOn,
      ...(rate ? { eur_try_rate: rate } : {}),
    }).eq("id", id);
    if (error) throw new Error(error.message);
  });
}

export async function deleteTransaction(formData: FormData) {
  const supabase = await createClient();
  await supabase.from("transactions").delete().eq("id", String(formData.get("id")));
  revalidatePath("/", "layout");
}


// ───────── Toplu düzenleme (İşlemler ekranında seçilen kayıtlar) ─────────
export type BulkResult = { ok: boolean; message: string };
const MAX_BULK = 200;

function parseIds(fd: FormData): string[] {
  try {
    const a = JSON.parse(String(fd.get("ids") ?? "[]"));
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)).slice(0, MAX_BULK) : [];
  } catch { return []; }
}

type BulkCtx = { ok: false; error: string } | { ok: true; supabase: Awaited<ReturnType<typeof createClient>>; ids: string[] };
async function bulkContext(fd: FormData): Promise<BulkCtx> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "Oturum bitti, tekrar giriş yap." };
  const ids = parseIds(fd);
  if (!ids.length) return { ok: false, error: "Önce işlem seç." };
  return { ok: true, supabase, ids };
}

// Seçilenlerin kategorisini toplu değiştirir. Transferler (kategorisiz) ve kategorinin türüyle uyuşmayanlar (gider ↔ gelir) atlanır.
export async function bulkSetCategory(fd: FormData): Promise<BulkResult> {
  const ctx = await bulkContext(fd);
  if (!ctx.ok) return { ok: false, message: ctx.error };
  const { supabase, ids } = ctx;
  const catId = String(fd.get("category_id") ?? "") || null;
  let catKind: string | null = null;
  if (catId) {
    const { data: c } = await supabase.from("categories").select("kind").eq("id", catId).single();
    if (!c) return { ok: false, message: "Kategori bulunamadı." };
    catKind = c.kind;
  }
  const { data: txns } = await supabase.from("transactions").select("id,kind").in("id", ids);
  const eligible = (txns ?? []).filter((t) => t.kind !== "transfer" && (!catKind || t.kind === catKind));
  if (!eligible.length) return { ok: false, message: "Seçilenlere bu kategori uygulanamaz (transferler ve türü uyuşmayanlar atlanır)." };
  const { error } = await supabase.from("transactions").update({ category_id: catId }).in("id", eligible.map((t) => t.id));
  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  const skipped = (txns?.length ?? 0) - eligible.length;
  return { ok: true, message: `${eligible.length} işlemin kategorisi güncellendi${skipped ? `, ${skipped} atlandı (transfer ya da tür uyuşmuyor)` : ""}.` };
}

// Seçilenleri başka hesaba taşır. Para birimi hesapla aynı olmalı (aksi halde bakiye ve kur bozulur); transferler atlanır.
export async function bulkMoveAccount(fd: FormData): Promise<BulkResult> {
  const ctx = await bulkContext(fd);
  if (!ctx.ok) return { ok: false, message: ctx.error };
  const { supabase, ids } = ctx;
  const accountId = String(fd.get("account_id") ?? "");
  const { data: acc } = accountId ? await supabase.from("accounts").select("currency,name").eq("id", accountId).single() : { data: null };
  if (!acc) return { ok: false, message: "Hesap seç." };
  const { data: txns } = await supabase.from("transactions").select("id,kind,currency").in("id", ids);
  const eligible = (txns ?? []).filter((t) => t.kind !== "transfer" && t.currency === acc.currency);
  if (!eligible.length) return { ok: false, message: `Seçilenler ${acc.currency} değil ya da transfer: para birimi farklı hesaba taşınamaz.` };
  const { error } = await supabase.from("transactions").update({ account_id: accountId }).in("id", eligible.map((t) => t.id));
  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  const skipped = (txns?.length ?? 0) - eligible.length;
  return { ok: true, message: `${eligible.length} işlem "${acc.name}" hesabına taşındı${skipped ? `, ${skipped} atlandı (para birimi farklı ya da transfer)` : ""}.` };
}

export async function bulkDelete(fd: FormData): Promise<BulkResult> {
  const ctx = await bulkContext(fd);
  if (!ctx.ok) return { ok: false, message: ctx.error };
  const { supabase, ids } = ctx;
  const { data, error } = await supabase.from("transactions").delete().in("id", ids).select("id");
  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  return { ok: true, message: `${data?.length ?? 0} işlem silindi.` };
}

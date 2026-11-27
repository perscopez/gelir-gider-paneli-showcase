"use server";

import { createClient } from "@/lib/supabase/server";
import { GROQ_DEFAULT_MODEL } from "@/lib/receipt";

// Anahtarın geçerli olup olmadığını model listesini isteyerek sınar (görsel/kota harcamaz).
export async function testProvider(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const { data } = await (await createClient()).auth.getUser();
  if (!data.user) return { ok: false, message: "Oturum gerekli." };
  const provider = String(formData.get("provider"));
  try {
    if (provider === "groq") {
      const key = process.env.GROQ_API_KEY;
      if (!key) return { ok: false, message: "GROQ_API_KEY ayarlı değil." };
      const model = process.env.GROQ_MODEL ?? GROQ_DEFAULT_MODEL;
      const r = await fetch(`${process.env.GROQ_API_BASE ?? "https://api.groq.com"}/openai/v1/models/${model}`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
      if (r.status === 401 || r.status === 403) return { ok: false, message: "Anahtar geçersiz." };
      if (r.status === 404) return { ok: false, message: `Anahtar çalışıyor ama "${model}" modeli yok (kapanmış olabilir). GROQ_MODEL'i sil ya da güncel bir görsel model yaz.` };
      return r.ok ? { ok: true, message: `Groq anahtarı ve model (${model}) çalışıyor.` } : { ok: false, message: `Groq yanıtı: ${r.status}` };
    }
    if (provider === "gemini") {
      const key = process.env.GEMINI_API_KEY;
      if (!key) return { ok: false, message: "GEMINI_API_KEY ayarlı değil." };
      const r = await fetch(`${process.env.GEMINI_API_BASE ?? "https://generativelanguage.googleapis.com"}/v1beta/models?pageSize=1`, { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(10_000) });
      if (r.status === 400 || r.status === 403) return { ok: false, message: "Anahtar geçersiz." };
      return r.ok ? { ok: true, message: "Gemini anahtarı çalışıyor." } : { ok: false, message: `Gemini yanıtı: ${r.status}` };
    }
  } catch {
    return { ok: false, message: "Servise ulaşılamadı." };
  }
  return { ok: false, message: "Bilinmeyen sağlayıcı." };
}

// Telegram webhook araçları: bot anahtarı yalnızca sunucuda kalır, ekrana ya da yanıta hiçbir gizli değer yazılmaz.
const tgApi = () => process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org";

export async function telegramCheck(): Promise<{ ok: boolean; message: string }> {
  const { data } = await (await createClient()).auth.getUser();
  if (!data.user) return { ok: false, message: "Oturum gerekli." };
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, message: "TELEGRAM_BOT_TOKEN ayarlı değil." };
  try {
    const r = await fetch(`${tgApi()}/bot${token}/getWebhookInfo`, { signal: AbortSignal.timeout(10_000) });
    const j = (await r.json()) as { ok: boolean; result?: { url?: string; pending_update_count?: number; last_error_message?: string; allowed_updates?: string[] } };
    if (!j.ok || !j.result) return { ok: false, message: "Telegram yanıt vermedi." };
    const w = j.result;
    if (!w.url) return { ok: false, message: "Webhook kurulu değil." };
    const buttons = !w.allowed_updates || w.allowed_updates.length === 0 || w.allowed_updates.includes("callback_query");
    const host = new URL(w.url).host;
    return {
      ok: buttons && !w.last_error_message,
      message: `Webhook: ${host} · "Ödedim" tuşu: ${buttons ? "çalışır" : "KAPALI (aç düğmesine bas)"} · bekleyen: ${w.pending_update_count ?? 0}${w.last_error_message ? ` · son hata: ${w.last_error_message}` : ""}`,
    };
  } catch {
    return { ok: false, message: "Telegram'a ulaşılamadı." };
  }
}

export async function telegramEnableButtons(): Promise<{ ok: boolean; message: string }> {
  const { data } = await (await createClient()).auth.getUser();
  if (!data.user) return { ok: false, message: "Oturum gerekli." };
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!token || !secret) return { ok: false, message: "TELEGRAM_BOT_TOKEN ya da TELEGRAM_WEBHOOK_SECRET ayarlı değil." };
  // Webhook adresi istek başlıklarından (Host) değil, yapılandırmadan gelir: sahte Host başlığı webhook'u başka sunucuya yönlendiremesin.
  const base = process.env.APP_URL?.replace(/\/+$/, "");
  if (!base || !/^https:\/\//.test(base)) return { ok: false, message: "APP_URL ayarlı değil (https://... olmalı)." };
  const url = `${base}/api/telegram`;
  try {
    const r = await fetch(`${tgApi()}/bot${token}/setWebhook`, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ url, secret_token: secret, allowed_updates: ["message", "callback_query"] }),
    });
    const j = (await r.json()) as { ok: boolean; description?: string };
    return j.ok ? { ok: true, message: "Webhook güncellendi: mesajlar ve tuş basışları artık iletilir." } : { ok: false, message: `Telegram: ${j.description ?? r.status}` };
  } catch {
    return { ok: false, message: "Telegram'a ulaşılamadı." };
  }
}

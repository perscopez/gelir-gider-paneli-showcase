import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/auth-secret";
import { parseQuick } from "@/lib/parse";
import { recordQuickTxn } from "@/lib/ingest";
import { inbox, telegramAnswerCallback, telegramEdit, telegramSend } from "@/lib/notify";
import { parsePaidData } from "@/lib/confirm-rules";
import { adminClient, ownerId } from "@/lib/supabase/admin";
import { latestRate } from "@/lib/fx";
import { todayISO } from "@/lib/date";
import { balancesText, periodSummary } from "@/lib/summary";
import { fmt } from "@/lib/money";
import { userMessage } from "@/lib/errors";
import { confirmTelegramStatement } from "@/lib/statements/telegram";
import { deleteLastTelegram, handleReceipt, type TgFileMessage } from "@/lib/receipt-flow";

// Fiş okuma birkaç saniye sürebilir.
export const maxDuration = 60;

type CallbackQuery = { id: string; data?: string; message?: { message_id: number; chat: { id: number } } };
type Update = { update_id?: number; callback_query?: CallbackQuery; message?: TgFileMessage & { text?: string; chat: { id: number } } };

export async function POST(req: Request) {
  if (!safeEqual(req.headers.get("x-telegram-bot-api-secret-token"), process.env.TELEGRAM_WEBHOOK_SECRET)) {
    return new NextResponse("forbidden", { status: 403 });
  }
  const update = (await req.json()) as Update;
  if (update.callback_query) {
    const cb = update.callback_query;
    if (cb.data?.startsWith("st:")) {
      if (cb.message && String(cb.message.chat.id) === process.env.TELEGRAM_CHAT_ID) {
        await confirmTelegramStatement(cb.message.chat.id, cb.message.message_id, cb.id, cb.data);
      }
    } else await handlePaid(cb);
    return NextResponse.json({ ok: true });
  }
  const msg = update.message;
  if (!msg) return NextResponse.json({ ok: true });
  const chat = msg.chat.id;
  const text = msg.text?.trim() ?? "";
  if (!text && !msg.photo && !msg.document) return NextResponse.json({ ok: true });

  // Kurulum: bota /start yazınca chat ID'ni görürsün, TELEGRAM_CHAT_ID olarak Vercel'e koy.
  if (text === "/start" && String(chat) !== process.env.TELEGRAM_CHAT_ID) {
    await telegramSend(chat, `Chat ID: ${chat}\nBunu Vercel'de TELEGRAM_CHAT_ID olarak ayarla.`);
    return NextResponse.json({ ok: true });
  }
  if (String(chat) !== process.env.TELEGRAM_CHAT_ID) return NextResponse.json({ ok: true }); // yabancıları yok say

  try {
    if (msg.photo || msg.document) await handleReceipt(chat, msg);
    else if (text === "/sil" || text === "/delete") await deleteLastTelegram(chat);
    else if (text === "/bakiye" || text === "/balance") await telegramSend(chat, await balancesText());
    else if (text === "/ozet" || text === "/summary") await telegramSend(chat, await periodSummary(30));
    else if (text === "/start" || text === "/help") {
      await telegramSend(chat, "Gider: `45 market` veya `12.5 eur kahve @fabrikam`\nGelir: `+1200 try freelance`\nEkstre: Fabrikam PDF gönder, önizle ve onayla.\nFiş: fotoğraf/PDF gönder. Eski fişte başlığa @nakit veya @hesap yaz.\n/bakiye  /ozet  /sil (son kaydı sil)");
    } else {
      const p = parseQuick(text);
      if (!p) await telegramSend(chat, "Anlamadım. Örnek: 45 market");
      else {
        // update_id ile tekilleştir: Telegram aynı güncellemeyi tekrar gönderirse (zaman aşımı/yeniden deneme) çift kayıt olmaz.
        const r = await recordQuickTxn({ ...p, source: "telegram", externalId: update.update_id ? `tgu:${update.update_id}` : undefined });
        await telegramSend(chat, `✓ ${p.kind === "income" ? "Gelir" : "Gider"} ${fmt(p.amount, r.currency, "tr")} → ${r.accountName}${p.merchant ? ` (${p.merchant})` : ""}`);
      }
    }
  } catch (e) {
    if (/duplicate key|external_uidx/i.test((e as Error).message)) return NextResponse.json({ ok: true }); // aynı güncelleme zaten işlendi
    await telegramSend(chat, userMessage(e, "telegram"));
  }
  return NextResponse.json({ ok: true });
}

// "✅ Ödedim" tuşu: ödeme kaydını yazar, kuralın o vadesini kapatır, mesajı onaylı hâle getirir. Tekrar basılırsa çift kayıt oluşmaz.
async function handlePaid(cb: CallbackQuery) {
  const chat = cb.message?.chat.id;
  if (!cb.message || String(chat) !== process.env.TELEGRAM_CHAT_ID) return; // yabancıları yok say
  const p = parsePaidData(cb.data);
  if (!p) { await telegramAnswerCallback(cb.id, "Geçersiz tuş"); return; }
  try {
    const db = adminClient();
    const uid = ownerId();
    const { data: r } = await db.from("recurring_rules").select("*").eq("id", p.ruleId).eq("user_id", uid).maybeSingle();
    if (!r) { await telegramAnswerCallback(cb.id, "Kural bulunamadı"); return; }
    const amount = Number(r.amount);
    const { error } = await db.from("transactions").insert({
      user_id: uid, account_id: r.account_id, category_id: r.category_id, kind: r.kind, amount, currency: r.currency, eur_try_rate: await latestRate(db),
      occurred_on: todayISO(), merchant: r.name, note: `Telegram'dan ödendi onaylandı (vade ${p.due})`, source: "telegram", external_id: `rec:${r.id}:${p.due}`,
    });
    const dup = error && (error.code === "23505" || /duplicate key/i.test(error.message));
    if (error && !dup) throw new Error(error.message);
    if (!r.last_run_on || p.due > r.last_run_on) await db.from("recurring_rules").update({ last_run_on: p.due }).eq("id", r.id);
    const text = `✅ ${r.name} ödendi: ${fmt(amount, r.currency, "tr")} (vade ${p.due.slice(8, 10)}.${p.due.slice(5, 7)}). Kaydı yazdım. Dekontu ev sahibine gönderdiysen tamam.`;
    await telegramAnswerCallback(cb.id, dup ? "Zaten kayıtlıydı" : "Kaydedildi");
    await telegramEdit(chat!, cb.message.message_id, text);
    if (!dup) await inbox(r.name, text);
  } catch (e) {
    await telegramAnswerCallback(cb.id, "Hata: kaydedilemedi, tekrar dene");
    console.error("[telegram paid]", (e as Error).message);
  }
}

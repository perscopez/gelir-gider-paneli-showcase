const telegramBase = () => process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org";

// Telegram'daki dosyayı (fotoğraf/PDF) indirir.
export async function telegramDownload(fileId: string): Promise<Uint8Array> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN yok");
  const info = (await fetch(`${telegramBase()}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`).then((r) => r.json())) as { ok: boolean; result?: { file_path?: string } };
  const path = info.result?.file_path;
  if (!info.ok || !path) throw new Error("Telegram dosyayı vermedi");
  const res = await fetch(`${telegramBase()}/file/bot${token}/${path}`);
  if (!res.ok) throw new Error("Telegram dosyası indirilemedi");
  return new Uint8Array(await res.arrayBuffer());
}

export async function telegramSend(chatId: string | number, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`${telegramBase()}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

// Telegram: satır içi tuşlu mesaj, tuş yanıtı ve mesaj düzenleme (onaylı hatırlatmalar için).
async function tgCall(method: string, body: Record<string, unknown>) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`${telegramBase()}/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
export const telegramSendButtons = (chatId: string | number, text: string, buttons: { text: string; data: string }[]) =>
  tgCall("sendMessage", { chat_id: chatId, text, reply_markup: { inline_keyboard: [buttons.map((b) => ({ text: b.text, callback_data: b.data }))] } });
export const telegramAnswerCallback = (id: string, text: string) => tgCall("answerCallbackQuery", { callback_query_id: id, text });
export const telegramEdit = (chatId: string | number, messageId: number, text: string) =>
  tgCall("editMessageText", { chat_id: chatId, message_id: messageId, text, reply_markup: { inline_keyboard: [] } });

// Resend ile e-posta gönderir; başarıyı döner (giriş kodu gibi kritik mesajlar için).
export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return false;
  try {
    const res = await fetch(process.env.RESEND_API_URL ?? "https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.NOTIFY_FROM ?? "Panel <onboarding@resend.dev>", to, subject, text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function emailSend(subject: string, text: string) {
  await sendMail(process.env.OWNER_EMAIL ?? "", subject, text);
}

// Uygulama içi bildirim kutusuna yazar (tablo henüz yoksa ya da admin anahtarı yoksa sessizce atlanır).
export async function inbox(title: string, body: string) {
  try {
    const { adminClient, ownerId } = await import("@/lib/supabase/admin");
    await adminClient().from("notifications").insert({ user_id: ownerId(), title, body });
  } catch { /* bildirim kutusu isteğe bağlı */ }
}

// Telegram + e-posta + uygulama içi kutu birlikte
export async function notify(subject: string, text: string) {
  const chat = process.env.TELEGRAM_CHAT_ID;
  await Promise.allSettled([chat ? telegramSend(chat, `${subject}\n${text}`) : Promise.resolve(), emailSend(subject, text), inbox(subject, text)]);
}

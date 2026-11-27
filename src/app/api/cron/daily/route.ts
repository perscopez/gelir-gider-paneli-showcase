import { NextResponse } from "next/server";
import { bearer, safeEqual } from "@/lib/auth-secret";
import { adminClient, ownerId } from "@/lib/supabase/admin";
import { fetchEurTry, latestRate } from "@/lib/fx";
import { notify, telegramSendButtons } from "@/lib/notify";
import { isConfirmRule, paidData, pendingDue, reminderText, type ConfirmRule } from "@/lib/confirm-rules";
import { fmt, type Currency } from "@/lib/money";
import { addDaysISO, addMonthsKey, dueDateISO, todayISO } from "@/lib/date";

export const maxDuration = 60;

// Kur servisi çökse de cron durmasın: önce taze kuru dene, olmazsa son kayıtlı kuru kullan.
async function safeRate(db: ReturnType<typeof adminClient>): Promise<number | null> {
  try {
    const { day, rate } = await fetchEurTry();
    await db.from("fx_rates").upsert({ day, eur_try: rate });
    return rate;
  } catch {
    try { return await latestRate(db); } catch { return null; }
  }
}

export async function GET(req: Request) {
  if (!safeEqual(bearer(req), process.env.CRON_SECRET)) return new NextResponse("forbidden", { status: 403 });
  const db = adminClient();
  const uid = ownerId();
  const rate = await safeRate(db);
  const today = todayISO();
  const thisKey = today.slice(0, 7);
  const msgs: string[] = [];
  if (rate === null) msgs.push("⚠ Kur alınamadı, tekrarlayan işlemler kur olmadan oluşturulamadı.");

  const { data: rules } = await db.from("recurring_rules").select("*").eq("user_id", uid).eq("active", true);
  for (const r of rules ?? []) {
    // Yakalama: cron bir gün çalışmasa bile vadesi gelmiş (bugün veya geçen ay/bu ay) işlem sonradan oluşturulur.
    if (r.auto_create && rate !== null) {
      for (const key of [addMonthsKey(thisKey, -1), thisKey]) {
        const due = dueDateISO(key, r.day_of_month);
        if (due > today || due < r.start_date || (r.end_date && due > r.end_date)) continue;
        if (r.last_run_on && due <= r.last_run_on) continue;
        const { error } = await db.from("transactions").insert({
          user_id: uid, account_id: r.account_id, category_id: r.category_id, kind: r.kind,
          ...(r.kind === "transfer" ? { to_account_id: r.to_account_id, to_amount: r.amount } : {}),
          amount: r.amount, currency: r.currency, eur_try_rate: rate, occurred_on: due,
          merchant: r.name, source: "recurring", recurring_rule_id: r.id,
          external_id: `rec:${r.id}:${due}`, // aynı vade iki kez oluşmaz
        });
        const duplicate = error?.code === "23505" || /duplicate key/i.test(error?.message ?? "");
        if (!error || duplicate) {
          await db.from("recurring_rules").update({ last_run_on: due }).eq("id", r.id);
          if (!duplicate) msgs.push(`${r.kind === "income" ? "＋" : r.kind === "transfer" ? "⇄" : "−"} ${r.name}: ${fmt(Number(r.amount), r.currency as Currency, "tr")}${due < today ? ` (${due})` : ""}`);
        }
      }
    }

    // Onaylı hatırlatma (kira gibi, ödemeyi sen yaparsın): vadeden önce başlar, "✅ Ödedim" tuşuna basana kadar her gün sürer.
    if (isConfirmRule(r as ConfirmRule)) {
      const p = pendingDue(r as ConfirmRule, today);
      const chat = process.env.TELEGRAM_CHAT_ID;
      if (p && chat) await telegramSendButtons(chat, reminderText(r.name, fmt(Number(r.amount), r.currency as Currency, "tr"), p.due, p.daysUntil), [{ text: "✅ Ödedim", data: paidData(r.id, p.due) }]);
      continue;
    }

    // Hatırlatma: bir sonraki vade (bu ay ya da gelecek ay) için `remind_days_before` gün kala.
    if (!r.auto_create || r.kind === "expense") {
      const dueThis = dueDateISO(thisKey, r.day_of_month);
      const next = dueThis >= today ? dueThis : dueDateISO(addMonthsKey(thisKey, 1), r.day_of_month);
      if (r.remind_days_before > 0 && addDaysISO(next, -r.remind_days_before) === today && (!r.end_date || next <= r.end_date)) {
        msgs.push(`⏰ ${r.name} ${r.remind_days_before} gün sonra: ${fmt(Number(r.amount), r.currency as Currency, "tr")}`);
      }
    }
  }

  // Kredi kartı son ödeme hatırlatması (3 gün kala)
  const { data: cards } = await db.from("accounts").select("name,due_day").eq("user_id", uid).eq("type", "credit_card").eq("archived", false);
  for (const c of cards ?? []) {
    if (!c.due_day) continue;
    const dueThis = dueDateISO(thisKey, c.due_day);
    const next = dueThis >= today ? dueThis : dueDateISO(addMonthsKey(thisKey, 1), c.due_day);
    if (addDaysISO(next, -3) === today) msgs.push(`💳 ${c.name} son ödeme 3 gün sonra`);
  }

  // Sessiz kopma uyarısı: otomatik kanallardan (e-posta, Apple Pay, Telegram) 7 gündür hiç kayıt gelmediyse haber ver (7, 14, 21... günde bir).
  const { data: lastAuto } = await db.from("transactions").select("created_at").eq("user_id", uid).in("source", ["email", "apple_pay", "telegram"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (lastAuto) {
    const age = Math.floor((Date.now() - new Date(lastAuto.created_at).getTime()) / 864e5);
    if (age >= 7 && age % 7 === 0) msgs.push(`⚠ ${age} gündür otomatik kanallardan (Gmail, Apple Pay, Telegram) hiç kayıt gelmedi. Apps Script tetikleyicisini ve Kısayolu kontrol et.`);
  }

  // Ayın 1'inde ve 15'inde ekstre hatırlatması: otomatik gelenler zaten varsa sadece teyit, gelmediyse "yükle" uyarısı (güvence katmanı).
  if (today.endsWith("-01") || today.endsWith("-15")) {
    const since = addDaysISO(today, -35);
    const has = async (prefix: string) => ((await db.from("transactions").select("id", { count: "exact", head: true }).eq("user_id", uid).like("external_id", `${prefix}%`).gte("created_at", `${since}T00:00:00Z`)).count ?? 0) > 0;
    const [anka, uc] = await Promise.all([has("vk:"), has("uc:")]);
    msgs.push(`📄 Ekstre günü. Fabrikam (Contoso Bank) ekstre PDF'ini İçe aktar sayfasından yükle${uc ? " (geçen ay da yüklenmişti)" : " (son 35 günde hiç yüklenmemiş)"}.`);
    if (today.endsWith("-01")) msgs.push(anka ? "✅ Anka Bank ekstresi otomatik geldi, ek bir şey gerekmez." : "⚠ Anka Bank ekstresi son 35 günde otomatik gelmedi: PDF'i Gmail'den indirip İçe aktar'dan yükle.");
  }

  if (msgs.length) await notify("Günlük bildirim", msgs.join("\n"));
  return NextResponse.json({ ok: true, rate, notified: msgs.length });
}

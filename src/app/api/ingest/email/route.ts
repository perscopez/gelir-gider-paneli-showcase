import { NextResponse } from "next/server";
import { z } from "zod";
import { bearer, safeEqual } from "@/lib/auth-secret";
import { bankName, parseBankEmail } from "@/lib/email-parse";
import { recordQuickTxn } from "@/lib/ingest";
import { notify } from "@/lib/notify";
import { fmt } from "@/lib/money";
import { addDaysISO, todayISO } from "@/lib/date";
import { adminClient, ownerId } from "@/lib/supabase/admin";

export const maxDuration = 30;

// Gmail köprüsü (integrations/gmail-bridge.gs) banka bildirim e-postalarını buraya yollar.
// Başlık: Authorization: Bearer <INGEST_SECRET>   Gövde: { from, subject, body, messageId? }
const Body = z.object({ from: z.string().max(300), subject: z.string().max(500).default(""), body: z.string().max(400_000), messageId: z.string().max(200).optional() });

export async function POST(req: Request) {
  if (!safeEqual(bearer(req), process.env.INGEST_SECRET)) return new NextResponse("forbidden", { status: 403 });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Geçersiz gövde" }, { status: 400 });

  const mail = parseBankEmail(p.data);
  if (!mail) return NextResponse.json({ ok: true, ignored: true }); // tanınmayan e-posta: sessizce atla

  // İşlem değil, hatırlatma (kredi kartı son ödeme/ekstre): hesaba yazılmaz, bildirim olarak gönderilir.
  if (mail.type === "reminder") {
    await notify("Kredi kartı", mail.text);
    return NextResponse.json({ ok: true, reminder: true });
  }

  try {
    const db = adminClient();
    const uid = ownerId();
    // Bu bankanın hesabı yoksa kur. Bakiye e-postada varsa açılış bakiyesi ona göre ayarlanır (gelirde bakiye − tutar, giderde bakiye + tutar), yoksa 0.
    const fold = (x: string) => x.toLowerCase().replace(/ı/g, "i");
    const key = fold(mail.bank).slice(0, 5); // banka anahtarının ilk harfleri: hesap adı "Anka TL", "Anka Bank" vb. olsa da eşleşir
    const { data: accs } = await db.from("accounts").select("*").eq("user_id", uid).eq("archived", false);
    const hasAccount = accs?.some((a) => a.currency === mail.currency && a.type !== "blocked" && a.type !== "reserve" && fold(`${a.name} ${a.institution ?? ""} ${a.match_keys ?? ""}`).includes(key));
    if (!hasAccount) {
      const opening = mail.balanceAfter === undefined ? 0 : mail.balanceAfter - (mail.kind === "income" ? mail.amount : -mail.amount);
      await db.from("accounts").insert({
        user_id: uid, name: bankName(mail.bank), institution: bankName(mail.bank), type: "bank", currency: mail.currency, opening_balance: Math.round(opening * 100) / 100,
      });
    }
    const r = await recordQuickTxn({
      kind: mail.kind, amount: mail.amount, currency: mail.currency, merchant: mail.merchant, accountHint: mail.bank,
      source: "email", externalId: mail.externalId, occurredOn: mail.occurredOn,
    });
    // Bakiye kontrolü: e-postadaki güncel bakiye panelle tutmuyorsa (e-postası gelmeyen bir işlem kaçmış olabilir) uyar. Eski e-postalar (toplu geri yükleme) atlanır.
    if (mail.balanceAfter !== undefined && hasAccount && (!mail.occurredOn || mail.occurredOn >= addDaysISO(todayISO(), -1))) {
      const { data: t } = await db.from("transactions").select("account_id").eq("id", r.id).single();
      const { data: b } = t ? await db.from("account_balances").select("balance").eq("account_id", t.account_id).single() : { data: null };
      if (b && Math.abs(Number(b.balance) - mail.balanceAfter) > 0.5) {
        await notify("⚠ Bakiye uyuşmuyor", `${r.accountName}: banka ${fmt(mail.balanceAfter, r.currency, "tr")}, panel ${fmt(Number(b.balance), r.currency, "tr")}. E-postası gelmeyen bir işlem olabilir (komisyon, otomatik ödeme...). Hesaplar'dan açılış bakiyesini ya da eksik işlemi düzelt.`);
      }
    }
    await notify("E-posta", `${mail.merchant}: ${mail.kind === "income" ? "+" : "−"}${fmt(r.amount, r.currency, "tr")} → ${r.accountName}`);
    return NextResponse.json({ ok: true, id: r.id, account: r.accountName });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("transactions_external_uidx") || msg.includes("duplicate key")) return NextResponse.json({ ok: true, duplicate: true });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { extractText, getDocumentProxy } from "unpdf";
import { bearer, safeEqual } from "@/lib/auth-secret";
import { notify } from "@/lib/notify";
import { fmt } from "@/lib/money";
import { rateForDate } from "@/lib/fx";
import { adminClient, ownerId } from "@/lib/supabase/admin";
import { detectStatement, parseAnkaDebit, parseAnkaCard, type ParsedCardStatement } from "@/lib/statements/anka";
import { suggestCategoryName } from "@/lib/statements/categorize";
import { findCardAccount, findAnkaBank, planRows, type Acc, type Existing } from "@/lib/statements/auto-import";
import { addDaysISO } from "@/lib/date";
import { parseAnkaAccount } from "@/lib/statements/anka-account";
import { importAccountStatement } from "@/lib/statements/account-import";
import { syncOpeningToStatement } from "@/lib/statements/sync";
import { applyStatement, type Update } from "@/lib/atomic";
import { categoryIdByKey } from "@/lib/customize";

export const maxDuration = 60;

// Gmail köprüsü, banka ekstre e-postalarındaki PDF'leri buraya yollar (Authorization: Bearer <INGEST_SECRET>).
// Ekstre doğrulanırsa hesaplar otomatik eşleşir ve işlemler yazılır; doğrulanmazsa hiçbir şey yazılmaz ve Telegram'a bildirim gider.
const Body = z.object({ filename: z.string().max(200).default("ekstre.pdf"), pdfBase64: z.string().max(6_000_000), messageId: z.string().max(200).optional() });

export async function POST(req: Request) {
  if (!safeEqual(bearer(req), process.env.INGEST_SECRET)) return new NextResponse("forbidden", { status: 403 });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Geçersiz gövde" }, { status: 400 });

  try {
    const bytes = new Uint8Array(Buffer.from(p.data.pdfBase64, "base64"));
    if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") return NextResponse.json({ ok: true, ignored: "pdf değil" });
    let text: string[];
    try {
      text = (await extractText(await getDocumentProxy(bytes), { mergePages: false })).text;
    } catch (e) {
      // Bozuk ya da şifreli PDF: yeniden denemenin faydası yok (yanıt 200), kullanıcı bilgilendirilir.
      console.error("[ingest/statement] pdf okunamadı", (e as Error).message);
      await notify("Ekstre", `⚠ ${p.data.filename} açılamadı (bozuk ya da şifreli olabilir), hiçbir şey kaydedilmedi. İçe aktar sayfasından elle yükle.`);
      return NextResponse.json({ ok: false, error: "pdf açılamadı" });
    }
    const kind = detectStatement(text);
    if (kind !== "anka-card" && kind !== "anka-debit" && kind !== "anka-account") return NextResponse.json({ ok: true, ignored: "tanınmayan ekstre" }); // Contoso Bank vb.: bu uçta işlenmez

    const db = adminClient();
    const uid = ownerId();
    let st;
    try {
      st = kind === "anka-card" ? parseAnkaCard(text) : kind === "anka-account" ? parseAnkaAccount(text) : parseAnkaDebit(text);
    } catch (e) {
      // Doğrulanamayan ekstre yazılmaz; kullanıcıya bildirilir (yanıt 200: Apps Script sonsuza dek yeniden denemesin).
      await notify("Ekstre", `⚠ ${p.data.filename} okunamadı, hiçbir şey kaydedilmedi: ${(e as Error).message}\nİçe aktar sayfasından elle yükleyebilirsin.`);
      return NextResponse.json({ ok: false, error: (e as Error).message });
    }

    const { data: accs } = await db.from("accounts").select("*").eq("user_id", uid).eq("archived", false);
    const accounts = (accs ?? []) as Acc[];
    const anka = findAnkaBank(accounts);
    if (kind === "anka-account") {
      if (!anka) {
        await notify("Ekstre", "⚠ Anka Bank hesap ekstresi geldi ama Anka Bank TL hesabı bulunamadı; hiçbir şey kaydedilmedi.");
        return NextResponse.json({ ok: false, error: "anka bank hesabı yok" });
      }
      return NextResponse.json(await importAccountStatement(db, uid, st, accounts, anka, p.data.filename));
    }
    let target: Acc | null;
    let createdNote = "";

    if (kind === "anka-card") {
      const card = (st as ParsedCardStatement).card;
      target = findCardAccount(accounts, card.last4);
      if (!target) {
        // Yoksa kur: açılış bakiyesi, ekstre sonunda bakiye −dönem borcu olacak şekilde ayarlanır.
        const { data: made, error } = await db.from("accounts").insert({
          user_id: uid, name: `Anka Bank Kredi Kartı ····${card.last4 ?? ""}`.trim(), institution: "Anka Bank", type: "credit_card", currency: "TRY",
          opening_balance: st.startingBalance, credit_limit: card.limit, due_day: card.dueDate ? Number(card.dueDate.slice(8, 10)) : null, statement_day: card.cutoff ? Number(card.cutoff.slice(8, 10)) : null,
        }).select("id,name,institution,currency,type").single();
        if (error || !made) throw new Error(error?.message ?? "kart hesabı açılamadı");
        target = made as Acc;
        createdNote = `\n🆕 "${target.name}" hesabı açıldı.`;
      }
    } else {
      target = anka;
      if (!target) {
        await notify("Ekstre", "⚠ Debit ekstresi geldi ama Anka Bank TL hesabı bulunamadı; hiçbir şey kaydedilmedi. Önce Hesaplar'dan ekle ya da içe aktar sayfasından yükle.");
        return NextResponse.json({ ok: false, error: "anka bank hesabı yok" });
      }
    }

    // Zaten içe aktarılmış mı + başka yoldan girilmiş mi (e-posta, Apple Pay, elle): ±3 gün, aynı tutar
    const ids = st.rows.map((r) => r.externalId);
    const { data: seenRows } = await db.from("transactions").select("external_id").eq("user_id", uid).in("external_id", ids);
    const seen = new Set((seenRows ?? []).map((r) => r.external_id as string));
    const from = addDaysISO(st.rows[0]?.date ?? st.periodFrom ?? "2026-01-01", -3);
    const to = addDaysISO(st.rows.at(-1)?.date ?? st.periodTo ?? "2026-12-31", 3);
    const load = async (accountId: string, kinds: string[]) =>
      ((await db.from("transactions").select("id,occurred_on,amount,kind,external_id,source,merchant").eq("user_id", uid).eq("account_id", accountId).in("kind", kinds).gte("occurred_on", from).lte("occurred_on", to)).data ?? []) as Existing[];

    const purchases = st.rows.filter((r) => r.kind !== "card_payment");
    const payments = st.rows.filter((r) => r.kind === "card_payment");
    const purchasePlan = planRows(purchases, await load(target.id, ["expense", "income"]), seen, (row, e) => e.kind === (row.amount < 0 ? "expense" : "income"));
    // Kart ödemeleri: Anka Bank hesabından çıkış (başka yoldan girilmiş olabilir)
    const paymentPlan = anka && payments.length ? planRows(payments, await load(anka.id, ["expense", "transfer"]), seen, () => true) : null;
    const skippedPayments = !anka ? payments : [];

    // Kategoriler: kullanıcının kuralları, sonra yerleşik sözlük
    const [{ data: cats }, { data: rules }] = await Promise.all([db.from("categories").select("*").eq("user_id", uid), db.from("category_rules").select("pattern,category_id").eq("user_id", uid)]);
    const categoryFor = (merchant: string, note: string | null) => {
      const m = merchant.toLowerCase();
      const hit = rules?.find((x) => m.includes(x.pattern.toLowerCase()))?.category_id;
      if (hit) return hit;
      const name = suggestCategoryName(merchant, note);
      return categoryIdByKey(cats, name);
    };
    const fallbackRate = await rateForDate(db, st.rows.at(-1)?.date ?? addDaysISO(new Date().toISOString().slice(0, 10), 0));
    const rateCache = new Map<string, number>();
    const rateOn = async (d: string) => rateCache.get(d) ?? (rateCache.set(d, await rateForDate(db, d, fallbackRate)), rateCache.get(d)!);

    const records: Record<string, unknown>[] = [];
    for (const row of purchasePlan.fresh) {
      records.push({
        user_id: uid, account_id: target.id, kind: row.amount < 0 ? "expense" : "income", amount: Math.abs(row.amount), currency: "TRY", eur_try_rate: await rateOn(row.date),
        occurred_on: row.date, merchant: row.merchant, note: row.note, category_id: categoryFor(row.merchant, row.note), source: "csv", external_id: row.externalId,
      });
    }
    for (const row of paymentPlan?.fresh ?? []) {
      records.push({
        user_id: uid, account_id: anka!.id, to_account_id: target.id, kind: "transfer", amount: Math.abs(row.amount), to_amount: Math.abs(row.amount), currency: "TRY",
        eur_try_rate: await rateOn(row.date), occurred_on: row.date, merchant: row.merchant, note: row.note, source: "csv", external_id: row.externalId,
      });
    }
    // Başka yoldan girilmiş kayıtları ekstre kimliğine bağla (bir sonraki içe aktarma "zaten var" desin);
    // tekrarlayan kural kaydı ekstredeki gerçek tutar/tarihle düzeltilir; kart ödemesi "gider" girilmişse karta yatan transfere çevrilir.
    const updates: Update[] = [];
    for (const r of purchasePlan.reconciled) {
      if (r.settle) updates.push({ id: r.existingId, patch: { external_id: r.row.externalId, amount: Math.abs(r.row.amount), occurred_on: r.row.date } });
      else if (r.link) updates.push({ id: r.existingId, patch: { external_id: r.row.externalId } });
    }
    for (const r of paymentPlan?.reconciled ?? []) {
      const amt = Math.abs(r.row.amount);
      updates.push({ id: r.existingId, patch: { kind: "transfer", to_account_id: target.id, to_amount: amt, category_id: null, ...(r.link ? { external_id: r.row.externalId } : {}) } });
    }
    await applyStatement(db, records, updates); // ekleme + güncellemeler tek veritabanı işleminde: ya hepsi ya hiçbiri

    // Kart ekstresi: ekstre kesim tarihindeki panel bakiyesi −dönem borcu olmalı
    let syncLine = "";
    if (kind === "anka-card") {
      const c = (st as ParsedCardStatement).card;
      const { delta } = await syncOpeningToStatement(db, target.id, c.cutoff ?? st.periodTo ?? st.rows.at(-1)!.date, st.finalBalance, new Set(ids), "vk:");
      syncLine = Math.abs(delta) > 0.005 ? `\n⚖ Kart bakiyesi ekstreyle eşitlendi (${fmt(delta, "TRY", "tr")} fark düzeltildi).` : "";
    }
    const reconciled = purchasePlan.reconciled.length + (paymentPlan?.reconciled.length ?? 0);
    const dup = purchasePlan.duplicates.length + (paymentPlan?.duplicates.length ?? 0);
    const money = (n: number) => fmt(n, "TRY", "tr");
    const head = kind === "anka-card" ? "💳 Kredi kartı ekstresi işlendi" : "🧾 Debit ekstresi işlendi";
    const cardLine = kind === "anka-card" ? `\nDönem borcu: ${money((st as ParsedCardStatement).card.debt)}${(st as ParsedCardStatement).card.minPayment ? ` · Asgari: ${money((st as ParsedCardStatement).card.minPayment!)}` : ""}${(st as ParsedCardStatement).card.dueDate ? ` · Son ödeme: ${(st as ParsedCardStatement).card.dueDate!.split("-").reverse().join(".")}` : ""}` : "";
    await notify("Ekstre", `${head}\n${records.length} yeni kayıt${reconciled ? `, ${reconciled} mevcut kayıtla eşleşti` : ""}${dup ? `, ${dup} zaten vardı` : ""}${skippedPayments.length ? `, ${skippedPayments.length} kart ödemesi atlandı (Anka Bank TL hesabı yok)` : ""}.${cardLine}${createdNote}${syncLine}`);
    return NextResponse.json({ ok: true, inserted: records.length, reconciled, duplicates: dup });
  } catch (e) {
    console.error("[ingest/statement]", e);
    const msg = (e as Error).message;
    if (msg.includes("duplicate key")) return NextResponse.json({ ok: true, duplicate: true });
    return NextResponse.json({ error: "ekstre işlenemedi" }, { status: 500 });
  }
}

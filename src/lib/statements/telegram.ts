import { createHash } from "node:crypto";
import { extractText, getDocumentProxy } from "unpdf";
import { adminClient, ownerId } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/paginate";
import { addDaysISO } from "@/lib/date";
import { fmt } from "@/lib/money";
import { rateForDate } from "@/lib/fx";
import { merchantsOverlap } from "@/lib/merge";
import { categoryIdByKey } from "@/lib/customize";
import { telegramAnswerCallback, telegramEdit, telegramSend, telegramSendButtons } from "@/lib/notify";
import { UserFacingError } from "@/lib/errors";
import { accText, planRows, type Existing } from "./auto-import";
import { suggestCategoryName } from "./categorize";
import { detectStatement } from "./anka";
import { parseContoso, type ParsedStatement } from "./contoso";

type Pending = { statement: ParsedStatement; signature: string };

async function prepare(st: ParsedStatement) {
  const db = adminClient();
  const uid = ownerId();
  const { data: accounts, error } = await db.from("accounts").select("id,name,institution,match_keys")
    .eq("user_id", uid).eq("type", "bank").eq("currency", st.currency).eq("archived", false);
  if (error) throw error;
  const candidates = (accounts ?? []).filter((a) => /fabrikam|contoso/i.test(accText(a)));
  if (candidates.length !== 1 || st.currency !== "EUR") throw new UserFacingError("Tek bir aktif Fabrikam EUR banka hesabı bulunmalı. Ekstreyi panelden de aktarabilirsin.");
  const account = candidates[0];
  const ids = new Set(st.rows.map((r) => r.externalId));
  const dates = st.rows.map((r) => r.date).sort();
  const from = addDaysISO(dates[0], -3);
  const to = addDaysISO(dates.at(-1)!, 3);
  type Candidate = Existing & { account_id: string; to_account_id: string | null; to_amount: number | null };
  const existing = await fetchAll<Candidate>((a, b) => db.from("transactions")
    .select("id,occurred_on,amount,kind,external_id,source,merchant,account_id,to_account_id,to_amount")
    .eq("user_id", uid).or(`account_id.eq.${account.id},to_account_id.eq.${account.id}`)
    .gte("occurred_on", from).lte("occurred_on", to).order("occurred_on").order("id").range(a, b));
  const seen = new Set(existing.flatMap((e) => e.external_id && ids.has(e.external_id) ? [e.external_id] : []));
  const links = await fetchAll<{ external_id: string; transaction_id: string }>((a, b) => db.from("telegram_statement_links")
    .select("external_id,transaction_id").eq("user_id", uid).eq("account_id", account.id)
    .gte("occurred_on", addDaysISO(from, -5)).lte("occurred_on", addDaysISO(to, 5)).order("external_id").range(a, b));
  const linked = new Set(links.map((link) => link.transaction_id));
  for (const link of links) if (ids.has(link.external_id)) seen.add(link.external_id);
  const pool = existing.filter((e) => !linked.has(e.id) && !e.external_id?.startsWith("uc:") && e.source !== "csv").map((e) =>
    e.to_account_id === account.id ? { ...e, kind: "income", amount: e.to_amount ?? e.amount } : e);
  const plan = planRows(st.rows, pool, seen, (row, e) =>
    Math.abs(Number(e.amount) - Math.abs(row.amount)) < 0.005 &&
    (row.amount < 0 ? ["expense", "transfer"].includes(e.kind) : e.kind === "income") &&
    (merchantsOverlap(row.merchant, e.merchant) || (row.kind === "transfer_in" && /^Fabrikam M\d+/i.test(row.note ?? "") && /fabrikam/i.test(e.merchant ?? ""))));

  const signature = createHash("sha256").update(JSON.stringify({ account: account.id, plan })).digest("hex");
  return { account, signature, plan, existing };
}

export async function previewTelegramStatement(chat: number, bytes: Uint8Array, explicit: boolean) {
  if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") throw new UserFacingError("Geçerli bir PDF gönder.");
  const pdf = await getDocumentProxy(bytes.slice());
  const { text } = await extractText(pdf, { mergePages: false });
  const kind = detectStatement(text);
  if (kind && kind !== "contoso") throw new UserFacingError("Bu banka ekstresini paneldeki İçe aktar ekranından yükle.");
  if (!explicit && kind !== "contoso" && !(/Contoso Bank/i.test(text.join("\n")) && /Starting balance|Booking date Participant/i.test(text.join("\n")))) return false;
  let st: ParsedStatement;
  try { st = parseContoso(text); }
  catch { throw new UserFacingError("Fabrikam ekstresi okunamadı. PDF’yi paneldeki İçe aktar ekranında kontrol et."); }
  if (!st.rows.length) {
    await telegramSend(chat, "Bu ekstrede işlem yok.");
    return true;
  }
  const { account, plan, signature } = await prepare(st);
  const db = adminClient();
  const uid = ownerId();
  const { error: cleanupError } = await db.from("telegram_statements").delete().eq("user_id", uid).lt("expires_at", new Date().toISOString());
  if (cleanupError) throw cleanupError;
  const { data, error } = await db.from("telegram_statements")
    .insert({ user_id: uid, payload: { statement: st, signature } }).select("id").single();
  if (error) throw error;

  const lines = plan.fresh.slice(0, 10).map((r) => `• ${r.date} · ${r.merchant.slice(0, 60)} · ${fmt(r.amount, "EUR", "tr")}`);
  if (plan.fresh.length > 10) lines.push(`… ${plan.fresh.length - 10} yeni işlem daha`);
  await telegramSendButtons(chat, [
    `🏦 ${account.name} · ${st.periodFrom ?? st.rows[0].date} – ${st.periodTo ?? st.rows.at(-1)!.date}`,
    `${plan.fresh.length} yeni · ${plan.reconciled.length} eşleşen · ${plan.duplicates.length} önceden aktarılmış`,
    `Ekstre kapanış bakiyesi ${fmt(st.finalBalance, "EUR", "tr")}`,
    ...lines,
  ].join("\n"), [{ text: "Onayla", data: `st:y:${data.id}` }, { text: "Vazgeç", data: `st:n:${data.id}` }]);
  return true;
}

export async function confirmTelegramStatement(chat: number, messageId: number, callbackId: string, action: string) {
  const match = /^st:([yn]):([a-f0-9-]{36})$/.exec(action);
  if (!match) return telegramAnswerCallback(callbackId, "Geçersiz tuş");
  const [, decision, id] = match;
  const db = adminClient();
  const uid = ownerId();
  try {
    const { data, error } = await db.from("telegram_statements").select("payload,status,expires_at").eq("id", id).eq("user_id", uid).maybeSingle();
    if (error) throw error;
    if (!data?.payload || data.status !== "pending" || Date.parse(data.expires_at) <= Date.now()) {
      return telegramAnswerCallback(callbackId, "Bu önizleme kapandı. Gerekirse PDF’yi tekrar gönder.");
    }
    const { statement: st, signature } = data.payload as Pending;
    const inserts = [];
    const updates = [];
    if (decision === "y") {
      const current = await prepare(st);
      if (signature !== current.signature) {
        await telegramAnswerCallback(callbackId, "Kayıtlar değişti. PDF’yi tekrar gönder.");
        return;
      }
      const [{ data: cats, error: catError }, { data: rules, error: ruleError }, { data: blocked, error: blockedError }] = await Promise.all([
        db.from("categories").select("*").eq("user_id", uid),
        db.from("category_rules").select("pattern,category_id").eq("user_id", uid),
        db.from("accounts").select("id").eq("user_id", uid).eq("currency", "EUR").eq("type", "blocked").eq("archived", false),
      ]);
      if (catError || ruleError || blockedError) throw catError ?? ruleError ?? blockedError;
      const dates = [...new Set(current.plan.fresh.map((r) => r.date))];
      const rates = new Map(await Promise.all(dates.map(async (date) => [date, await rateForDate(db, date)] as const)));
      for (const row of current.plan.fresh) {
        const transfer = row.kind === "transfer_in" && /^Fabrikam M\d+/i.test(row.note ?? "");
        if (transfer && blocked?.length !== 1) throw new UserFacingError("Bloke aktarımı için tek bir aktif EUR bloke hesabı gerekli.");
        const category = rules?.find((r) => row.merchant.toLowerCase().includes(r.pattern.toLowerCase()))?.category_id
          ?? categoryIdByKey(cats, suggestCategoryName(row.merchant, row.note));
        inserts.push({
          user_id: uid, account_id: transfer ? blocked![0].id : current.account.id,
          kind: transfer ? "transfer" : row.amount < 0 ? "expense" : "income",
          to_account_id: transfer ? current.account.id : null, to_amount: transfer ? row.amount : null,
          category_id: row.amount < 0 ? category : null, amount: Math.abs(row.amount), currency: "EUR",
          eur_try_rate: rates.get(row.date), occurred_on: row.date, merchant: row.merchant, note: row.note,
          source: "csv", external_id: row.externalId,
        });
      }
      for (const item of current.plan.reconciled) {
        const existing = current.existing.find((e) => e.id === item.existingId)!;
        updates.push({ id: existing.id, expected: existing, accountId: current.account.id, externalId: item.row.externalId, date: item.row.date });
      }
    }
    const result = await db.rpc("finish_telegram_statement", { p_id: id, p_user: uid, p_confirm: decision === "y", p_inserts: inserts, p_updates: updates });
    if (result.error) throw result.error;
    if (!result.data) return telegramAnswerCallback(callbackId, "Bu önizleme kapandı.");
    await telegramAnswerCallback(callbackId, decision === "y" ? "Kaydedildi" : "İptal edildi");
    await telegramEdit(chat, messageId, decision === "y" ? `✅ Ekstre işlendi. ${inserts.length} yeni kayıt, ${updates.length} mevcut kayıt bağlandı.` : "Ekstre aktarımı iptal edildi.");
  } catch (e) {
    console.error("[telegram statement]", e instanceof Error ? e.message : e);
    await telegramAnswerCallback(callbackId, e instanceof UserFacingError ? e.message : "İşlem tamamlanamadı. Tekrar dene veya PDF’yi yeniden gönder.");
  }
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { fmt } from "@/lib/money";
import { notify } from "@/lib/notify";
import { rateForDate } from "@/lib/fx";
import { addDaysISO } from "@/lib/date";
import { syncOpeningToStatement } from "./sync";
import { applyStatement, type Update } from "@/lib/atomic";
import { suggestCategoryName } from "./categorize";
import { categoryIdByKey } from "@/lib/customize";
import { findCardAccount, planRows, type Acc, type Existing } from "./auto-import";
import type { ParsedStatement } from "./contoso";

// Anka Bank vadesiz hesap ekstresinin (Hesap Hareketleri) otomatik içe aktarması.
// Satırlar işlem numarasıyla tekilleştirilir; e-posta/Apple Pay/elle girilmiş kayıtlarla (aynı tutar ±3 gün) eşleşir; kart borcu ödemeleri karta transfer olur.
// Ekstre güncelse (son 1-2 gün) panelin bakiyesi bankadaki bakiyeye eşitlenir (açılış bakiyesi kalibre edilir) ve fark bildirilir.
export async function importAccountStatement(db: SupabaseClient, uid: string, st: ParsedStatement, accounts: Acc[], bank: Acc, filename: string) {
  const ids = st.rows.map((r) => r.externalId);
  const { data: seenRows } = await db.from("transactions").select("external_id").eq("user_id", uid).in("external_id", ids);
  const seen = new Set((seenRows ?? []).map((r) => r.external_id as string));
  const from = addDaysISO(st.rows[0].date, -3);
  const to = addDaysISO(st.rows.at(-1)!.date, 3);
  const loaded = ((await db.from("transactions").select("id,occurred_on,amount,kind,external_id,source,merchant").eq("user_id", uid).eq("account_id", bank.id).in("kind", ["expense", "income", "transfer"]).gte("occurred_on", from).lte("occurred_on", to)).data ?? []) as Existing[];
  const kindOf = new Map(loaded.map((e) => [e.id, e.kind]));

  const [{ data: cats }, { data: rules }] = await Promise.all([db.from("categories").select("*").eq("user_id", uid), db.from("category_rules").select("pattern,category_id").eq("user_id", uid)]);
  const categoryFor = (merchant: string, note: string | null) => {
    const hit = rules?.find((x) => merchant.toLowerCase().includes(x.pattern.toLowerCase()))?.category_id;
    if (hit) return hit;
    const n = suggestCategoryName(merchant, note);
    return categoryIdByKey(cats, n);
  };
  const fallback = await rateForDate(db, st.rows.at(-1)!.date);
  const cache = new Map<string, number>();
  const rateOn = async (d: string) => cache.get(d) ?? (cache.set(d, await rateForDate(db, d, fallback)), cache.get(d)!);

  const pay = st.rows.filter((r) => r.kind === "card_payment");
  const rest = st.rows.filter((r) => r.kind !== "card_payment");
  // Gelir/gider eşleşmesi: yön aynı olmalı. Kart ödemesi: giden kayıt (gider ya da zaten transfer).
  const restPlan = planRows(rest, loaded.filter((e) => e.kind !== "transfer"), seen, (row, e) => e.kind === (row.amount < 0 ? "expense" : "income"));
  const payPlan = planRows(pay, loaded.filter((e) => e.kind !== "income"), seen, () => true);

  const records: Record<string, unknown>[] = [];
  for (const row of restPlan.fresh) {
    const abs = Math.abs(row.amount);
    records.push({
      user_id: uid, account_id: bank.id, kind: row.amount < 0 ? "expense" : "income", amount: abs, currency: "TRY", eur_try_rate: await rateOn(row.date),
      occurred_on: row.date, merchant: row.merchant, note: row.note, category_id: row.amount < 0 ? categoryFor(row.merchant, row.note) : null, source: "csv", external_id: row.externalId,
    });
  }
  for (const row of payPlan.fresh) {
    const card = findCardAccount(accounts, row.cardLast4);
    const abs = Math.abs(row.amount);
    records.push({
      user_id: uid, account_id: bank.id, ...(card ? { kind: "transfer", to_account_id: card.id, to_amount: abs } : { kind: "expense" }), amount: abs, currency: "TRY",
      eur_try_rate: await rateOn(row.date), occurred_on: row.date, merchant: row.merchant, note: row.note, source: "csv", external_id: row.externalId,
    });
  }
  const updates: Update[] = [];
  for (const r of restPlan.reconciled) {
    if (r.settle) updates.push({ id: r.existingId, patch: { external_id: r.row.externalId, amount: Math.abs(r.row.amount), occurred_on: r.row.date } });
    else if (r.link) updates.push({ id: r.existingId, patch: { external_id: r.row.externalId } });
  }
  for (const r of payPlan.reconciled) {
    const card = findCardAccount(accounts, r.row.cardLast4);
    const patch: Record<string, unknown> = r.link ? { external_id: r.row.externalId } : {};
    if (kindOf.get(r.existingId) === "expense" && card) Object.assign(patch, { kind: "transfer", to_account_id: card.id, to_amount: Math.abs(r.row.amount), category_id: null });
    if (Object.keys(patch).length) updates.push({ id: r.existingId, patch });
  }
  await applyStatement(db, records, updates); // ekleme + güncellemeler tek veritabanı işleminde

  // Bakiye eşitleme: ekstre tarihindeki panel bakiyesi ekstredeki bakiyeyle tutmalı (geriye dönük ekstrelerde de geçerli)
  const { delta, skipped } = await syncOpeningToStatement(db, bank.id, st.periodTo ?? st.rows.at(-1)!.date, st.finalBalance, new Set(ids), "vh:");
  const syncLine = skipped ? "" : Math.abs(delta) > 0.005
    ? `\n⚖ Bakiye bankayla eşitlendi (${fmt(delta, "TRY", "tr")} fark düzeltildi): ${fmt(st.finalBalance, "TRY", "tr")}`
    : `\n✅ Panel bakiyesi bankayla tutuyor: ${fmt(st.finalBalance, "TRY", "tr")}`;
  const matched = restPlan.reconciled.length + payPlan.reconciled.length;
  const dup = restPlan.duplicates.length + payPlan.duplicates.length;
  await notify("Ekstre", `🏦 Anka Bank hesap ekstresi işlendi (${filename})\n${records.length} yeni kayıt${matched ? `, ${matched} mevcut kayıtla eşleşti` : ""}${dup ? `, ${dup} zaten vardı` : ""}.${syncLine}`);
  return { ok: true, inserted: records.length, reconciled: matched, duplicates: dup };
}

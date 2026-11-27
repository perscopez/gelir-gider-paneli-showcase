"use server";

import { revalidatePath } from "next/cache";
import { extractText, getDocumentProxy } from "unpdf";
import { createClient } from "@/lib/supabase/server";
import { rateForDate } from "@/lib/fx";
import { fetchAll } from "@/lib/paginate";
import { balanceFrom, type BalanceRow } from "@/lib/balance";
import { todayISO } from "@/lib/date";
import { parseContoso, type ParsedStatement } from "@/lib/statements/contoso";
import { checkStatementAccount } from "@/lib/statements/check";
import { detectStatement, parseAnkaDebit, parseAnkaCard, type ParsedCardStatement } from "@/lib/statements/anka";
import { parseLaleCard } from "@/lib/statements/lale";
import { parseAnkaAccount } from "@/lib/statements/anka-account";
import { suggestCategoryName } from "@/lib/statements/categorize";
import { categoryIdByKey } from "@/lib/customize";
import { currentRate } from "@/lib/data";
import type { CommitResult, PreviewResult, PreviewRow } from "./types";

const MAX_BYTES = 8 * 1024 * 1024;

async function readStatement(file: unknown): Promise<ParsedStatement> {
  if (!(file instanceof File) || file.size === 0) throw new Error("PDF dosyası seç.");
  if (file.size > MAX_BYTES) throw new Error("Dosya 8 MB'dan büyük.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") throw new Error("Bu bir PDF dosyası değil.");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  // Biçim otomatik anlaşılır: Anka Bank kredi kartı, debit özeti ya da Contoso Bank/Fabrikam.
  const kind = detectStatement(text);
  if (kind === "anka-card") return parseAnkaCard(text);
  if (kind === "anka-debit") return parseAnkaDebit(text);
  if (kind === "lale-card") return parseLaleCard(text);
  if (kind === "anka-account") {
    // Elle içe aktarmada kart ödemesi bu hesaptan çıkan normal bir çıkış olarak yazılır (otomatik akış karta transfer yapar).
    const st = parseAnkaAccount(text);
    return { ...st, rows: st.rows.map((r) => (r.kind === "card_payment" ? { ...r, kind: "other" as const } : r)) };
  }
  return parseContoso(text);
}

async function loadContext(accountId: string) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Oturum bitti, tekrar giriş yap.");
  const { data: account } = await supabase.from("accounts").select("id,name,currency,type").eq("id", accountId).single();
  if (!account) throw new Error("Hesap bulunamadı.");
  return { supabase, account };
}

async function seenStatementIds(supabase: Awaited<ReturnType<typeof createClient>>, st: ParsedStatement) {
  const seen = new Set<string>();
  const ids = st.rows.map((row) => row.externalId);
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const [transactions, links] = await Promise.all([
      supabase.from("transactions").select("external_id").in("external_id", batch),
      st.bank === "contoso"
        ? supabase.from("telegram_statement_links").select("external_id").in("external_id", batch)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (transactions.error || links.error) throw new Error((transactions.error ?? links.error)!.message);
    for (const row of [...(transactions.data ?? []), ...(links.data ?? [])]) if (row.external_id) seen.add(row.external_id);
  }
  return seen;
}

export async function previewStatement(formData: FormData): Promise<PreviewResult> {
  try {
    const accountId = String(formData.get("account_id") ?? "");
    const { supabase, account } = await loadContext(accountId);
    const st = await readStatement(formData.get("file"));
    checkStatementAccount(st, account);
    const isCard = st.bank === "anka-card" || st.bank === "lale-card";
    // Kredi kartı ödemeleri başka bir hesaptan karta transfer olarak yazılır: kaynak hesap seçilmeli.
    const sourceId = String(formData.get("source_account_id") ?? "");
    const { data: sourceAcc } = isCard && sourceId ? await supabase.from("accounts").select("id,name,currency,type").eq("id", sourceId).maybeSingle() : { data: null };
    if (isCard && sourceId && (!sourceAcc || sourceAcc.currency !== st.currency || sourceAcc.type === "credit_card" || sourceAcc.type === "blocked" || sourceAcc.type === "reserve")) throw new Error("Ödeme kaynağı için aynı para biriminde bir banka/nakit hesabı seç.");

    // Bakiye ekstre bitiş tarihi itibarıyla hesaplanır: sonradan yapılan işlemler (bugünkü bakiyeyi değiştirenler) farkı bozmasın.
    const asOf = st.periodTo ?? st.rows.at(-1)?.date ?? todayISO();
    const [{ data: cats }, { data: rules }, balRows, { data: acc }, { data: blocked }] = await Promise.all([
      supabase.from("categories").select("*"),
      supabase.from("category_rules").select("pattern,category_id"),
      fetchAll<BalanceRow>((a, b) => supabase.from("transactions").select("kind,amount,to_amount,account_id,to_account_id")
        .or(`account_id.eq.${accountId},to_account_id.eq.${accountId}`).lte("occurred_on", asOf).order("occurred_on").order("id").range(a, b)),
      supabase.from("accounts").select("opening_balance").eq("id", accountId).single(),
      supabase.from("accounts").select("name").eq("type", "blocked").eq("archived", false).eq("currency", st.currency).limit(1),
    ]);

    // Zaten içe aktarılmış mı?
    const seenSet = await seenStatementIds(supabase, st);

    // Aynı işlem başka yoldan (Apple Pay, Telegram, elle) girilmiş olabilir: tutar + ±3 gün
    const from = new Date(new Date(st.rows[0]?.date ?? st.periodFrom ?? new Date()).getTime() - 3 * 864e5).toISOString().slice(0, 10);
    const to = new Date(new Date(st.rows.at(-1)?.date ?? st.periodTo ?? new Date()).getTime() + 3 * 864e5).toISOString().slice(0, 10);
    const { data: existing } = await supabase.from("transactions").select("id,occurred_on,amount,kind,merchant,source")
      .eq("account_id", accountId).gte("occurred_on", from).lte("occurred_on", to).neq("source", "csv");
    // Hesaba gelen transferler (örn. Fabrikam Bloke → Banka tekrarlayan kuralı) ekstrede gelir satırı olarak görünür: eşleşme için gelir gibi say.
    const { data: inbound } = await supabase.from("transactions").select("id,occurred_on,amount,kind,merchant,source")
      .eq("to_account_id", accountId).eq("kind", "transfer").gte("occurred_on", from).lte("occurred_on", to);
    const pool = [...(existing ?? []), ...(inbound ?? []).map((t) => ({ ...t, kind: "income", amount: Number(t.amount) }))];
    // Kart ödemeleri için: kaynak hesapta aynı tutarda çıkış (başka yoldan girilmiş olabilir)
    const { data: srcOut } = isCard && sourceId
      ? await supabase.from("transactions").select("id,occurred_on,amount,kind,merchant,source").eq("account_id", sourceId).in("kind", ["expense", "transfer"]).gte("occurred_on", from).lte("occurred_on", to)
      : { data: [] as { id: string; occurred_on: string; amount: number; kind: string; merchant: string | null; source: string }[] };
    const srcPool = [...(srcOut ?? [])];

    const rows: PreviewRow[] = st.rows.map((r, idx) => {
      const m = `${r.merchant}`.toLowerCase();
      const ruleHit = rules?.find((x) => m.includes(x.pattern.toLowerCase()))?.category_id ?? null;
      const sugg = suggestCategoryName(r.merchant, r.note);
      const categoryId = ruleHit ?? categoryIdByKey(cats, sugg);
      const fromBlocked = r.kind === "transfer_in" && /^Fabrikam M\d+/i.test(r.note ?? "") && !!blocked?.length;

      let status: PreviewRow["status"] = seenSet.has(r.externalId) ? "duplicate" : "new";
      let matchedWith: string | null = null;
      const isPayment = r.kind === "card_payment";
      if (status === "new" && isPayment) {
        const hit = srcPool.findIndex((e) => Math.abs(Number(e.amount) - Math.abs(r.amount)) < 0.005 && Math.abs(new Date(e.occurred_on).getTime() - new Date(r.date).getTime()) <= 3 * 864e5);
        if (hit >= 0) { const e = srcPool.splice(hit, 1)[0]; status = "maybe"; matchedWith = `${e.source} · ${e.occurred_on}${e.merchant ? ` · ${e.merchant}` : ""}`; }
      } else if (status === "new") {
        const hit = pool.findIndex((e) =>
          Math.abs(Number(e.amount) - Math.abs(r.amount)) < 0.005 && (r.amount < 0 ? e.kind === "expense" || e.kind === "transfer" : e.kind === "income")
          && Math.abs(new Date(e.occurred_on).getTime() - new Date(r.date).getTime()) <= 3 * 864e5);
        if (hit >= 0) {
          const e = pool.splice(hit, 1)[0];
          status = "maybe";
          matchedWith = `${e.source} · ${e.occurred_on}${e.merchant ? ` · ${e.merchant}` : ""}`;
        }
      }
      return { idx, date: r.date, amount: r.amount, merchant: r.merchant, note: r.note, kind: r.kind, categoryId: isPayment ? null : categoryId, status, matchedWith, fromBlocked, isPayment };
    });

    return {
      ok: true,
      data: {
        currency: st.currency, periodFrom: st.periodFrom, periodTo: st.periodTo,
        startingBalance: st.startingBalance, finalBalance: st.finalBalance, ibanLast4: st.ibanLast4, rows,
        accountBalance: balanceFrom(Number(acc?.opening_balance ?? 0), accountId, balRows), asOf, accountOpening: Number(acc?.opening_balance ?? 0),
        blockedAccountName: blocked?.[0]?.name ?? null,
        statementKind: st.bank, balanceKnown: st.balanceKnown !== false, paymentSource: sourceAcc?.name ?? null,
        card: st.bank === "anka-card" ? { ...(st as ParsedCardStatement).card } : null,
      },
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

type Selection = { include: boolean; categoryId: string | null; asBlockedTransfer?: boolean };

export async function commitStatement(formData: FormData): Promise<CommitResult> {
  try {
    const accountId = String(formData.get("account_id") ?? "");
    const { supabase, account } = await loadContext(accountId);
    const st = await readStatement(formData.get("file")); // tutarlar sunucuda yeniden okunur, istemciye güvenilmez
    checkStatementAccount(st, account);
    const sourceId = String(formData.get("source_account_id") ?? "");
    const sel = JSON.parse(String(formData.get("selection") ?? "{}")) as Record<string, Selection>;

    const fallback = await currentRate();
    if (!fallback) throw new Error("Güncel kur yok. Önce /api/cron/daily çağrılmalı (README adım 5).");

    const seenSet = await seenStatementIds(supabase, st);

    const { data: blocked } = await supabase.from("accounts").select("id").eq("type", "blocked").eq("archived", false).eq("currency", st.currency).limit(1);
    const blockedId = blocked?.[0]?.id ?? null;

    // Kart ödemesi satırları kaynak hesap olmadan yazılamaz (hangi hesaptan çıktığı bilinmeli).
    if (st.bank === "anka-card" || st.bank === "lale-card") {
      const wantsPayment = st.rows.some((r, idx) => r.kind === "card_payment" && sel[String(idx)]?.include && !seenSet.has(r.externalId));
      if (wantsPayment && !sourceId) throw new Error("Kredi kartı ödemesini içe aktarmak için ödemenin çıktığı hesabı seç (ya da ödeme satırının seçimini kaldır).");
    }
    const chosen = st.rows.map((r, idx) => ({ r, s: sel[String(idx)] })).filter(({ r, s }) => s?.include && !seenSet.has(r.externalId));
    const dates = [...new Set(chosen.map(({ r }) => r.date))];
    const rates = new Map(await Promise.all(dates.map(async (d) => [d, await rateForDate(supabase, d, fallback)] as const)));

    const records = chosen.map(({ r, s }) => {
      const abs = Math.round(Math.abs(r.amount) * 100) / 100;
      const base = {
        category_id: s.categoryId || null, currency: st.currency, eur_try_rate: rates.get(r.date) ?? fallback,
        occurred_on: r.date, merchant: r.merchant, note: r.note, source: "csv" as const, external_id: r.externalId,
      };
      if (r.kind === "card_payment") {
        // Kaynak hesaptan karta transfer: kaynak bakiye düşer, kart borcu azalır.
        return { ...base, kind: "transfer" as const, account_id: sourceId, to_account_id: accountId, amount: abs, to_amount: abs, category_id: null };
      }
      if (r.amount > 0 && s.asBlockedTransfer && blockedId) {
        return { ...base, kind: "transfer" as const, account_id: blockedId, to_account_id: accountId, amount: abs, to_amount: abs, category_id: null };
      }
      return { ...base, kind: r.amount < 0 ? ("expense" as const) : ("income" as const), account_id: accountId, amount: abs };
    });

    // Tek istek = tek veritabanı işlemi: ya hepsi yazılır ya hiçbiri (yarım içe aktarma kalmaz).
    if (records.length) {
      const { error } = await supabase.from("transactions").insert(records);
      if (error) throw new Error(error.message);
    }
    revalidatePath("/", "layout");
    return { ok: true, imported: records.length, skipped: st.rows.length - records.length };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

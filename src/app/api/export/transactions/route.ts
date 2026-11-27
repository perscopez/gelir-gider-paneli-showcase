import { createClient } from "@/lib/supabase/server";
import { monthKey } from "@/lib/date";
import { fetchAll } from "@/lib/paginate";
import { filteredTransactions, parseFilters } from "@/app/(app)/transactions/query";

// Filtrelenmiş işlemleri CSV olarak indirir (oturum gerekir: proxy korur, RLS yalnız sahibin satırlarını verir).
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new Response("unauthorized", { status: 401 });

  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const f = parseFilters(sp, monthKey());
  // Tüm satırlar sayfalanarak çekilir (sunucu sınırı 1.000 satır).
  const data = await fetchAll<Record<string, unknown>>((a, b) => filteredTransactions(
    supabase,
    "occurred_on,kind,amount,to_amount,currency,eur_try_rate,merchant,note,source,account:accounts!transactions_account_id_fkey(name),to_account:accounts!transactions_to_account_id_fkey(name,currency),category:categories(name_tr)",
    f,
  ).order("occurred_on", { ascending: false }).order("id").range(a, b));

  const esc = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // CSV formül enjeksiyonunu engelle (Excel/Sheets)
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = data.map((r) => [
    r.occurred_on, r.kind, r.amount, r.currency, r.to_amount, (r.to_account as { currency?: string } | null)?.currency, r.eur_try_rate,
    (r.account as { name?: string } | null)?.name, (r.to_account as { name?: string } | null)?.name,
    (r.category as { name_tr?: string } | null)?.name_tr, r.merchant, r.note, r.source,
  ].map(esc).join(","));
  const header = "date,type,amount,currency,to_amount,to_currency,eur_try_rate,account,to_account,category,merchant,note,source";
  const name = `islemler-${f.month || "tumu"}.csv`;
  return new Response("﻿" + [header, ...rows].join("\r\n"), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" },
  });
}

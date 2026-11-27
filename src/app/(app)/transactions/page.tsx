import Link from "next/link";
import { ChevronLeft, ChevronRight, Download, ListChecks, Paperclip, Pencil, ReceiptText, Trash2, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getLocale, t } from "@/lib/i18n";
import { fmt, toEur, type Currency } from "@/lib/money";
import { addMonthsKey, monthKey } from "@/lib/date";
import { Notice, Field, inputCls } from "@/components/field";
import { fetchAll } from "@/lib/paginate";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { CategoryIcon } from "@/components/category-icon";
import { FormDialog } from "@/components/form-dialog";
import { ConfirmDelete } from "@/components/confirm-delete";
import { receiptLabels } from "@/lib/receipt-labels";
import { ReceiptItems, type ReceiptLine } from "@/components/receipt-items";
import { InfoDialog } from "@/components/info-dialog";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { deleteTransaction, updateTransaction } from "./actions";
import { TransactionFilters } from "./filters";
import { BulkBar } from "./bulk-bar";
import { loadPriceIndex } from "@/lib/price-data";
import { judge } from "@/lib/price-verdict";
import { PAGE_SIZE, filteredTransactions, parseFilters, toQuery } from "./query";

export const metadata = { title: "İşlemler" };

const TOTAL_SELECT = "occurred_on,kind,amount,currency,eur_try_rate,account:accounts!transactions_account_id_fkey(type),to_account:accounts!transactions_to_account_id_fkey(type)";

type Row = {
  id: string; kind: "income" | "expense" | "transfer"; amount: number; to_amount: number | null; currency: Currency; occurred_on: string;
  merchant: string | null; note: string | null; category_id: string | null; receipt_path: string | null;
  account: { name: string; currency: Currency } | null; to_account: { name: string; currency: Currency } | null;
  category: { name_tr: string; name_en: string } | null;
};
type TotalRow = { occurred_on: string; kind: string; amount: number; currency: Currency; eur_try_rate: number; account: { type: string } | null; to_account: { type: string } | null };
type Item = ReceiptLine & { transaction_id: string };

export default async function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  const locale = await getLocale();
  const L = t(locale);
  const supabase = await createClient();
  const f = parseFilters(await searchParams, monthKey());

  const [{ data: accounts }, { data: categories }] = await Promise.all([
    supabase.from("accounts").select("id,name,currency,type").eq("archived", false).order("sort_order"),
    supabase.from("categories").select("id,name_tr,name_en,kind").order("name_tr"),
  ]);
  if (!accounts?.length) {
    return (
      <>
        <PageHeader title={L.transactions} />
        <Notice>{L.needAccount} <Link href="/accounts" className="underline">{L.goAccounts}</Link></Notice>
      </>
    );
  }
  const catLabel = (c: { name_tr: string; name_en: string }) => (locale === "tr" ? c.name_tr : c.name_en);
  const from = (f.page - 1) * PAGE_SIZE;

  const [{ data: rowsRaw, count }, totalsRaw] = await Promise.all([
    filteredTransactions(
      supabase,
      "id,kind,amount,to_amount,currency,occurred_on,merchant,note,category_id,receipt_path,account:accounts!transactions_account_id_fkey(name,currency),to_account:accounts!transactions_to_account_id_fkey(name,currency),category:categories(name_tr,name_en)",
      f, true,
    ).order("occurred_on", { ascending: false }).order("created_at", { ascending: false }).range(from, from + PAGE_SIZE - 1),
    // Aylık toplamda bloke ödemesi 25'inden sonra geldiyse sonraki aya sayılır (panelle aynı kural): önceki ayın 25'inden itibaren al.
    fetchAll<TotalRow>((a, b) => (f.month
      ? filteredTransactions(supabase, TOTAL_SELECT, { ...f, month: "" }).gte("occurred_on", `${addMonthsKey(f.month, -1)}-25`).lt("occurred_on", `${addMonthsKey(f.month, 1)}-01`)
      : filteredTransactions(supabase, TOTAL_SELECT, f)
    ).order("occurred_on").order("id").range(a, b)),
  ]);
  const rows = (rowsRaw ?? []) as unknown as Row[];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  let inc = 0, exp = 0;
  for (const r of totalsRaw) {
    const held = (t?: string) => t === "blocked" || t === "reserve";
    const isPayout = r.kind === "transfer" && held(r.account?.type) && !held(r.to_account?.type);
    const kind = isPayout ? "income" : r.kind;
    if (kind === "transfer") continue;
    if (f.month) {
      const key = isPayout && r.account?.type === "blocked" && Number(r.occurred_on.slice(8, 10)) >= 25 ? addMonthsKey(r.occurred_on.slice(0, 7), 1) : r.occurred_on.slice(0, 7);
      if (key !== f.month) continue;
    }
    const eur = toEur(Number(r.amount), r.currency, Number(r.eur_try_rate));
    if (kind === "income") inc += eur; else exp += eur;
  }

  // Market fişi kalemleri ve fiş dosyaları (0002 çalıştırılmadıysa tablo yoktur: sessizce atla)
  const ids = rows.map((r) => r.id);
  const { data: itemRows } = ids.length
    ? await supabase.from("receipt_items").select("transaction_id,line_no,name,product,brand,quantity,unit,pack_amount,pack_unit,unit_price,line_total,category,base_unit,price_per_base,currency,merchant").in("transaction_id", ids).order("line_no")
    : { data: null };
  const itemsByTx = new Map<string, Item[]>();
  // Her ürün kalemi kendi geçmiş fiyat medyanına göre ucuz/normal/pahalı olarak işaretlenir.
  const priceIndex = itemRows?.length ? await loadPriceIndex(supabase) : null;
  for (const raw of (itemRows ?? []) as Item[]) {
    const it = priceIndex ? { ...raw, verdict: judge(raw.price_per_base ? Number(raw.price_per_base) : null, raw.product, raw.base_unit, priceIndex, raw.transaction_id) } : raw;
    itemsByTx.set(it.transaction_id, [...(itemsByTx.get(it.transaction_id) ?? []), it]);
  }
  const paths = rows.map((r) => r.receipt_path).filter((p): p is string => !!p);
  const signed = paths.length ? (await supabase.storage.from("receipts").createSignedUrls(paths, 600)).data ?? [] : [];
  const receiptUrl = new Map(signed.map((x) => [x.path, x.signedUrl]));

  const qs = (patch: Record<string, string | number | undefined>) => toQuery({ ...f, month: f.month || "all", ...patch });
  const exportHref = `/api/export/transactions?${toQuery({ ...f, month: f.month || "all", page: undefined })}`;
  const hasFilter = !!(f.q || f.account || f.category || f.kind);

  return (
    <div className="space-y-5">
      <PageHeader
        title={L.transactions}
        description={`${total} ${locale === "tr" ? "kayıt" : "records"}`}
        actions={<a href={exportHref} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}><Download className="size-4" />{L.exportCsv}</a>}
      />

      <TransactionFilters
        month={f.month}
        locale={locale}
        accounts={accounts.map((a) => ({ id: a.id, label: a.name }))}
        categories={(categories ?? []).map((c) => ({ id: c.id, label: catLabel(c) }))}
        labels={{
          search: L.search, all: L.all, account: L.account, category: L.category, kind: L.kind, income: L.kindIncome, expense: L.kindExpense,
          transfer: L.kindTransfer, uncategorized: L.uncategorized, allMonths: locale === "tr" ? "Tüm zamanlar" : "All time", clear: locale === "tr" ? "Temizle" : "Clear",
        }}
      />

      <section className="grid gap-3 sm:grid-cols-3">
        <StatCard label={L.income} tone="positive" value={fmt(inc, "EUR", locale)} />
        <StatCard label={L.expense} tone="negative" value={fmt(exp, "EUR", locale)} />
        <StatCard label={L.net} tone={inc - exp >= 0 ? "positive" : "negative"} value={fmt(inc - exp, "EUR", locale)} />
      </section>

      {!rows.length ? (
        <EmptyState
          icon={hasFilter ? ListChecks : Wallet}
          title={hasFilter ? L.noResults : L.empty}
          description={hasFilter ? undefined : (locale === "tr" ? "Sağ üstteki “Yeni işlem” ile ilk kaydını ekle." : "Use “New transaction” at the top to add your first one.")}
        />
      ) : (
        <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          <BulkBar tr={locale === "tr"} categories={(categories ?? []).map((c) => ({ id: c.id, label: catLabel(c) }))} accounts={accounts.filter((a) => a.type !== "blocked" && a.type !== "reserve").map((a) => ({ id: a.id, label: `${a.name} (${a.currency})` }))} />
          <ul className="divide-y">
            {rows.map((r) => {
              const cat = r.category ? catLabel(r.category) : null;
              const title = r.kind === "transfer" ? `${r.account?.name} → ${r.to_account?.name}` : (r.merchant ?? cat ?? L.none);
              const link = r.receipt_path ? receiptUrl.get(r.receipt_path) : undefined;
              const items = itemsByTx.get(r.id);
              return (
                <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                  <input type="checkbox" data-bulk value={r.id} aria-label={title} className="size-4 shrink-0" />
                  <CategoryIcon name={cat} kind={r.kind} className="hidden sm:flex" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{title}</span>
                      {link ? <a href={link} target="_blank" rel="noreferrer" title={L.viewReceipt} aria-label={L.viewReceipt} className="text-muted-foreground hover:text-foreground"><Paperclip className="size-3.5" /></a> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      <span>{r.occurred_on}</span><span>·</span><span>{r.account?.name}</span>
                      {cat && r.kind !== "transfer" ? <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">{cat}</Badge> : null}
                      {r.note ? <span className="truncate italic">“{r.note}”</span> : null}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={cn("tnum text-sm font-semibold", r.kind === "income" && "text-positive")}>
                      {r.kind === "income" ? "+" : r.kind === "expense" ? "−" : "⇄ "}{fmt(Number(r.amount), r.currency, locale)}
                    </div>
                    {r.kind === "transfer" && r.to_account && r.to_amount != null && r.to_account.currency !== r.currency ? (
                      <div className="tnum text-xs text-muted-foreground">→ {fmt(Number(r.to_amount), r.to_account.currency, locale)}</div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center">
                    {items?.length ? (
                      <InfoDialog
                        trigger={<Button variant="ghost" size="icon-sm" aria-label={`${L.items} (${items.length})`} title={`${L.items} (${items.length})`}><ReceiptText className="size-4" /></Button>}
                        title={`${title} · ${L.items}`}
                        description={`${r.occurred_on} · ${items.length}`}
                      >
                        <ReceiptItems items={items} locale={locale} labels={receiptLabels(locale === "tr")} />
                      </InfoDialog>
                    ) : null}
                    {r.kind !== "transfer" ? (
                      <FormDialog
                        trigger={<Button variant="ghost" size="icon-sm" aria-label={L.edit} title={L.edit}><Pencil className="size-4" /></Button>}
                        title={L.edit}
                        action={updateTransaction}
                        submit={L.save}
                        resetOnSuccess={false}
                      >
                        <input type="hidden" name="id" value={r.id} />
                        <Field label={L.amount}><input name="amount" required inputMode="decimal" defaultValue={Number(r.amount)} className={inputCls} /></Field>
                        <Field label={L.date}><input name="occurred_on" type="date" defaultValue={r.occurred_on} className={inputCls} /></Field>
                        <Field label={L.category}>
                          <select name="category_id" defaultValue={r.category_id ?? ""} className={inputCls}>
                            <option value="">—</option>
                            {(categories ?? []).map((c) => <option key={c.id} value={c.id}>{catLabel(c)}</option>)}
                          </select>
                        </Field>
                        <Field label={L.merchant}><input name="merchant" defaultValue={r.merchant ?? ""} className={inputCls} /></Field>
                        <Field label={L.note} className="sm:col-span-2"><input name="note" defaultValue={r.note ?? ""} className={inputCls} /></Field>
                      </FormDialog>
                    ) : null}
                    <ConfirmDelete
                      action={deleteTransaction}
                      id={r.id}
                      title={L.confirmDeleteTitle}
                      description={`${title} · ${fmt(Number(r.amount), r.currency, locale)}. ${L.confirmDeleteDesc}`}
                      confirm={L.remove}
                      cancel={L.cancel}
                      done={L.deleted}
                      trigger={<Button variant="ghost" size="icon-sm" aria-label={L.remove} title={L.remove} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-4" /></Button>}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-between text-sm" aria-label="Sayfalama">
          <span className="text-muted-foreground">{from + 1}–{Math.min(from + PAGE_SIZE, total)} / {total}</span>
          <div className="flex items-center gap-2">
            {f.page > 1 ? <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/transactions?${qs({ page: f.page - 1 })}`}><ChevronLeft className="size-4" />{L.prev}</Link> : null}
            <span className="tnum text-muted-foreground">{f.page} / {pages}</span>
            {f.page < pages ? <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/transactions?${qs({ page: f.page + 1 })}`}>{L.next}<ChevronRight className="size-4" /></Link> : null}
          </div>
        </nav>
      )}
    </div>
  );
}

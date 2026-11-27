import Link from "next/link";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getLocale, t } from "@/lib/i18n";
import { currentRate } from "@/lib/data";
import { fmt, toEur, toTry, type Currency } from "@/lib/money";
import { run } from "@/lib/action";
import { monthKey, monthStartISO } from "@/lib/date";
import { activeBudgets, budgetAlertPct, budgetLimitEur, type BudgetRow } from "@/lib/customize";
import { Plus, PiggyBank, Trash2, Pencil } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { FormDialog } from "@/components/form-dialog";
import { ConfirmDelete } from "@/components/confirm-delete";
import { CategoryIcon } from "@/components/category-icon";
import { Button } from "@/components/ui/button";
import { Field, Notice, inputCls } from "@/components/field";

const monthStart = (v: FormDataEntryValue | null) => { const m = String(v ?? ""); return /^\d{4}-\d{2}$/.test(m) ? `${m}-01` : null; };
const monthEnd = (v: FormDataEntryValue | null) => {
  const m = String(v ?? "");
  if (!/^\d{4}-\d{2}$/.test(m)) return null;
  const [y, mo] = m.split("-").map(Number);
  return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0")}`;
};

// Ekle ya da düzenle (id varsa düzenler). Aynı kategoriye farklı dönemler için birden çok bütçe konabilir.
async function saveBudget(formData: FormData) {
  "use server";
  return run(async () => {
    const limit = Number(String(formData.get("limit")).trim().replace(",", "."));
    if (!(limit > 0)) throw new Error("Limit 0'dan büyük olmalı.");
    const alert = Math.round(Number(formData.get("alert_pct")) || 80);
    if (alert < 1 || alert > 100) throw new Error("Uyarı eşiği 1-100 arası olmalı.");
    const valid_from = monthStart(formData.get("valid_from"));
    const valid_to = monthEnd(formData.get("valid_to"));
    if (valid_from && valid_to && valid_to < valid_from) throw new Error("Bitiş ayı başlangıçtan önce olamaz.");
    const row = {
      category_id: String(formData.get("category_id")), monthly_limit_eur: limit, currency: formData.get("currency") === "TRY" ? "TRY" : "EUR",
      alert_pct: alert, valid_from, valid_to, label: String(formData.get("label") || "").trim() || null,
    };
    const supabase = await createClient();
    const id = String(formData.get("id") || "");
    const { error } = id ? await supabase.from("budgets").update(row).eq("id", id) : await supabase.from("budgets").insert(row);
    if (error) throw new Error(/budgets_user_cat_from_uidx|duplicate key/i.test(error.message) ? "Bu kategori için aynı başlangıç ayına sahip bir bütçe zaten var. Başlangıç ayını değiştir ya da onu düzenle." : error.message);
    revalidatePath("/", "layout");
  });
}

async function removeBudget(formData: FormData) {
  "use server";
  const supabase = await createClient();
  await supabase.from("budgets").delete().eq("id", String(formData.get("id")));
  revalidatePath("/", "layout");
}

export const metadata = { title: "Bütçeler" };

export default async function BudgetsPage() {
  const locale = await getLocale();
  const L = t(locale);
  const supabase = await createClient();
  const rate = await currentRate();
  const monthStartDate = monthStartISO();
  const thisMonth = monthKey();

  const [{ data: cats }, { data: budgets }, { data: spentRows }] = await Promise.all([
    supabase.from("categories").select("id,name_tr,name_en,icon").eq("kind", "expense").order("name_tr"),
    supabase.from("budgets").select("*"),
    supabase.from("transactions").select("category_id,amount,currency,eur_try_rate").eq("kind", "expense").gte("occurred_on", monthStartDate),
  ]);

  const spent = new Map<string, number>();
  for (const r of spentRows ?? []) {
    if (!r.category_id) continue;
    spent.set(r.category_id, (spent.get(r.category_id) ?? 0) + toEur(Number(r.amount), r.currency as Currency, Number(r.eur_try_rate)));
  }
  const cat = (id: string) => cats?.find((x) => x.id === id);
  const name = (id: string) => {
    const c = cat(id);
    return c ? (locale === "tr" ? c.name_tr : c.name_en) : L.none;
  };
  const dual = (eur: number) => `${fmt(eur, "EUR", locale)}${rate ? ` · ${fmt(toTry(eur, "EUR", rate), "TRY", locale)}` : ""}`;

  if (!cats?.length) {
    return (
      <>
        <PageHeader title={L.budgets} />
        <Notice>{L.needCategory} <Link href="/settings" className="underline">{L.goSettings}</Link></Notice>
      </>
    );
  }

  const tr = locale === "tr";
  const trigger = <Button size="sm"><Plus className="size-4" />{L.add}</Button>;
  // Ekleme ve düzenleme aynı formu kullanır.
  const form = (b?: BudgetRow) => (
    <>
      {b ? <input type="hidden" name="id" value={b.id} /> : null}
      <Field label={L.categoryExpense}>
        <select name="category_id" required defaultValue={b?.category_id} className={inputCls}>
          {cats.map((c) => <option key={c.id} value={c.id}>{locale === "tr" ? c.name_tr : c.name_en}</option>)}
        </select>
      </Field>
      <Field label={tr ? "Ad / not" : "Label"} hint={L.optional}><input name="label" defaultValue={b?.label ?? ""} placeholder={tr ? "Örn. Aralık-Ocak" : "e.g. Dec-Jan"} className={inputCls} /></Field>
      <Field label={L.monthlyLimit}><input name="limit" required inputMode="decimal" defaultValue={b ? String(b.monthly_limit_eur) : ""} className={inputCls} /></Field>
      <Field label={L.currency}>
        <select name="currency" defaultValue={b?.currency ?? "EUR"} className={inputCls}><option value="EUR">EUR</option><option value="TRY">TRY</option></select>
      </Field>
      <Field label={tr ? "Uyarı eşiği (%)" : "Alert at (%)"} hint={tr ? "Bu orana gelince çubuk sarı olur" : "Bar turns amber at this level"}>
        <input name="alert_pct" type="number" min={1} max={100} defaultValue={b?.alert_pct ?? 80} className={inputCls} />
      </Field>
      <div />
      <Field label={tr ? "Geçerli: başlangıç ayı" : "Valid from (month)"} hint={tr ? "Boş = her zaman" : "Empty = always"}><input name="valid_from" type="month" defaultValue={b?.valid_from?.slice(0, 7) ?? ""} className={inputCls} /></Field>
      <Field label={tr ? "Geçerli: bitiş ayı" : "Valid to (month)"} hint={tr ? "Boş = süresiz" : "Empty = open-ended"}><input name="valid_to" type="month" defaultValue={b?.valid_to?.slice(0, 7) ?? ""} className={inputCls} /></Field>
      <p className="text-xs text-muted-foreground sm:col-span-2">{tr ? "Aynı kategoriye farklı dönemler için ayrı bütçe ekleyebilirsin (örn. Aralık-Ocak 260 €, Şubat'tan sonra 200 €)." : "You can add separate budgets for different periods of the same category."}</p>
    </>
  );
  const dialog = (
    <FormDialog trigger={trigger} title={L.budgets} action={saveBudget} submit={L.save} className="grid gap-3 sm:grid-cols-2">{form()}</FormDialog>
  );

  const rows = (budgets ?? []) as BudgetRow[];
  const active = activeBudgets(rows, thisMonth);
  const activeIds = new Set(active.map((b) => b.id));
  const others = rows.filter((b) => !activeIds.has(b.id));
  const period = (b: BudgetRow) => (b.valid_from || b.valid_to ? `${b.valid_from?.slice(0, 7) ?? "…"} → ${b.valid_to?.slice(0, 7) ?? "…"}` : null);

  const card = (b: BudgetRow, live: boolean) => {
    const limit = budgetLimitEur(b, rate);
    const used = live ? spent.get(b.category_id) ?? 0 : 0;
    const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
    const overBy = used - limit;
    const tone = used > limit ? "bg-red-500" : pct > budgetAlertPct(b) ? "bg-amber-500" : "bg-emerald-500";
    return (
      <li key={b.id} className={`rounded-xl border bg-card p-5 shadow-xs ${live ? "" : "opacity-70"}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2 font-medium">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted"><CategoryIcon name={cat(b.category_id)?.icon} kind="expense" className="size-4" /></span>
            <span className="min-w-0"><span className="block truncate">{name(b.category_id)}</span>
              {b.label || period(b) ? <span className="block truncate text-xs font-normal text-muted-foreground">{[b.label, period(b)].filter(Boolean).join(" · ")}</span> : null}</span>
          </span>
          <span className="flex shrink-0">
            <FormDialog trigger={<Button variant="ghost" size="icon-sm" aria-label={L.edit} className="text-muted-foreground"><Pencil className="size-4" /></Button>}
              title={`${name(b.category_id)}: ${L.edit}`} action={saveBudget} submit={L.save} className="grid gap-3 sm:grid-cols-2">{form(b)}</FormDialog>
            <ConfirmDelete action={removeBudget} id={b.id} title={`${name(b.category_id)}: ${L.remove}?`}
              trigger={<Button variant="ghost" size="icon-sm" aria-label={L.remove} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-4" /></Button>} />
          </span>
        </div>
        <div className="mt-4 flex items-baseline justify-between">
          <span className="text-xl font-semibold tabular-nums">{fmt(used, "EUR", locale)}</span>
          <span className="text-sm text-muted-foreground">/ {fmt(Number(b.monthly_limit_eur), (b.currency === "TRY" ? "TRY" : "EUR") as Currency, locale)}{b.currency === "TRY" ? ` (≈ ${fmt(limit, "EUR", locale)})` : ""}</span>
        </div>
        <div className="my-2 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
        </div>
        {live ? (
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{L.spent}: {dual(used)}</span>
            <span className={overBy > 0 ? "font-medium text-destructive" : ""}>{overBy > 0 ? `${dual(overBy)} ${L.over}` : `${L.left}: ${dual(-overBy)}`}</span>
          </div>
        ) : <div className="text-xs text-muted-foreground">{tr ? "Bu ay geçerli değil" : "Not active this month"}</div>}
      </li>
    );
  };

  return (
    <div>
      <PageHeader title={L.budgets} actions={dialog} />
      {!rows.length ? <EmptyState icon={PiggyBank} title={L.empty} action={dialog} /> : (
        <>
          <ul className="grid gap-4 sm:grid-cols-2">{active.map((b) => card(b, true))}</ul>
          {others.length ? (
            <>
              <h2 className="mt-8 mb-3 text-sm font-medium text-muted-foreground">{tr ? "Başka dönemler" : "Other periods"}</h2>
              <ul className="grid gap-4 sm:grid-cols-2">{others.map((b) => card(b, false))}</ul>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

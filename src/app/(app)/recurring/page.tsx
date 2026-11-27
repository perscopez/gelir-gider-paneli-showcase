import Link from "next/link";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getLocale, t } from "@/lib/i18n";
import { fmt, type Currency } from "@/lib/money";
import { run } from "@/lib/action";
import { addMonthsKey, dueDateISO, todayISO } from "@/lib/date";
import { Pencil, Plus, Repeat, Trash2, Pause, Play } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { FormDialog } from "@/components/form-dialog";
import { ConfirmDelete } from "@/components/confirm-delete";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Notice, inputCls } from "@/components/field";

const num = (v: FormDataEntryValue | null) => Number(String(v ?? "").replace(",", "."));

// Ekle ya da düzenle (id varsa düzenler). Tür: gelir, gider ya da transfer (hesaplar arası aylık aktarım).
async function saveRule(formData: FormData) {
  "use server";
  return run(async () => {
    const supabase = await createClient();
    const accountId = String(formData.get("account_id"));
    const { data: acc } = await supabase.from("accounts").select("currency").eq("id", accountId).single();
    const amount = num(formData.get("amount"));
    if (!acc) throw new Error("Hesap bulunamadı.");
    if (!(amount > 0)) throw new Error("Tutar 0'dan büyük olmalı.");
    const day = Math.round(num(formData.get("day")));
    if (!(day >= 1 && day <= 31)) throw new Error("Ayın günü 1-31 arası olmalı.");
    const k = String(formData.get("kind"));
    const kind = k === "income" ? "income" : k === "transfer" ? "transfer" : "expense";
    let to_account_id: string | null = null;
    if (kind === "transfer") {
      to_account_id = String(formData.get("to_account_id") || "");
      const { data: dest } = to_account_id ? await supabase.from("accounts").select("currency").eq("id", to_account_id).single() : { data: null };
      if (!dest) throw new Error("Transfer için hedef hesabı seç.");
      if (to_account_id === accountId) throw new Error("Kaynak ve hedef hesap aynı olamaz.");
      if (dest.currency !== acc.currency) throw new Error("Transfer kuralında iki hesabın para birimi aynı olmalı.");
    }
    const row = {
      name: String(formData.get("name")),
      account_id: accountId,
      to_account_id,
      category_id: kind === "transfer" ? null : String(formData.get("category_id") || "") || null,
      kind,
      amount,
      currency: acc.currency,
      day_of_month: day,
      auto_create: formData.get("auto_create") === "on",
      remind_days_before: Math.max(0, Math.round(num(formData.get("remind")) || 0)),
      start_date: String(formData.get("start_date") || "") || todayISO(),
      end_date: String(formData.get("end_date") || "") || null,
    };
    const id = String(formData.get("id") || "");
    const { error } = id ? await supabase.from("recurring_rules").update(row).eq("id", id) : await supabase.from("recurring_rules").insert(row);
    if (error) throw new Error(error.message);
    revalidatePath("/", "layout");
  });
}

async function toggleRule(formData: FormData) {
  "use server";
  const supabase = await createClient();
  await supabase.from("recurring_rules").update({ active: formData.get("active") === "true" }).eq("id", String(formData.get("id")));
  revalidatePath("/", "layout");
}

async function removeRule(formData: FormData) {
  "use server";
  const supabase = await createClient();
  await supabase.from("recurring_rules").delete().eq("id", String(formData.get("id")));
  revalidatePath("/", "layout");
}

function nextDate(day: number, today: string) {
  const key = today.slice(0, 7);
  const thisMonth = dueDateISO(key, day);
  return thisMonth >= today ? thisMonth : dueDateISO(addMonthsKey(key, 1), day);
}

export const metadata = { title: "Düzenli işlemler" };

export default async function RecurringPage() {
  const locale = await getLocale();
  const L = t(locale);
  const supabase = await createClient();
  const [{ data: accounts }, { data: categories }, { data: rules }] = await Promise.all([
    supabase.from("accounts").select("id,name,currency").eq("archived", false).order("sort_order"),
    supabase.from("categories").select("id,name_tr,name_en").order("name_tr"),
    supabase.from("recurring_rules").select("*, account:accounts!recurring_rules_account_id_fkey(name)").order("created_at"),
  ]);
  const today = todayISO();
  const catName = (id: string | null) => {
    const c = categories?.find((x) => x.id === id);
    return c ? (locale === "tr" ? c.name_tr : c.name_en) : L.none;
  };

  if (!accounts?.length) {
    return (
      <>
        <PageHeader title={L.recurring} />
        <Notice>{L.needAccount} <Link href="/accounts" className="underline">{L.goAccounts}</Link></Notice>
      </>
    );
  }

  const trigger = <Button size="sm"><Plus className="size-4" />{L.add}</Button>;
  const tr = locale === "tr";
  const only = "hidden group-has-[option[value=transfer]:checked]:contents";
  const notTransfer = "group-has-[option[value=transfer]:checked]:hidden";
  type Rule = NonNullable<typeof rules>[number];
  const form = (r?: Rule) => (
    <>
      {r ? <input type="hidden" name="id" value={r.id} /> : null}
      <Field label={L.name} hint="Örn. Fabrikam aylık ödeme, Kira" className="sm:col-span-2"><input name="name" required defaultValue={r?.name ?? ""} className={inputCls} /></Field>
      <Field label={L.kind}>
        <select name="kind" defaultValue={r?.kind ?? "income"} className={inputCls}>
          <option value="income">{L.kindIncome}</option><option value="expense">{L.kindExpense}</option><option value="transfer">{tr ? "Transfer (hesaplar arası)" : "Transfer"}</option>
        </select>
      </Field>
      <Field label={L.amount} hint={L.amountHint}><input name="amount" required inputMode="decimal" defaultValue={r ? String(r.amount) : ""} className={inputCls} /></Field>
      <Field label={tr ? "Hesap (kaynak)" : "Account (source)"}>
        <select name="account_id" required defaultValue={r?.account_id} className={inputCls}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
        </select>
      </Field>
      <div className={only}>
        <Field label={tr ? "Hedef hesap" : "Destination account"}>
          <select name="to_account_id" defaultValue={r?.to_account_id ?? ""} className={inputCls}>
            <option value="">—</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
          </select>
        </Field>
      </div>
      <Field label={L.dayOfMonth} hint="Her ayın bu günü (31 ise ay sonu)"><input name="day" type="number" required min={1} max={31} defaultValue={r?.day_of_month ?? ""} className={inputCls} /></Field>
      <div className={notTransfer}>
        <Field label={L.categoryOpt}>
          <select name="category_id" defaultValue={r?.category_id ?? ""} className={inputCls}>
            <option value="">—</option>
            {categories?.map((c) => <option key={c.id} value={c.id}>{locale === "tr" ? c.name_tr : c.name_en}</option>)}
          </select>
        </Field>
      </div>
      <Field label={L.remindDays} hint={L.remindHint}><input name="remind" type="number" min={0} max={30} defaultValue={r?.remind_days_before ?? 2} className={inputCls} /></Field>
      <Field label={L.startDate} hint={L.optional}><input name="start_date" type="date" defaultValue={r?.start_date ?? ""} className={inputCls} /></Field>
      <Field label={L.endDate} hint={L.optional}><input name="end_date" type="date" defaultValue={r?.end_date ?? ""} className={inputCls} /></Field>
      <label className="flex items-center gap-2 self-center text-sm sm:col-span-2">
        <input type="checkbox" name="auto_create" defaultChecked={r ? r.auto_create : true} /> {L.createMonthly}
      </label>
      <p className="text-xs text-muted-foreground sm:col-span-2">{tr ? "İşaretli değilse (gider kuralı): vadeden önce Telegram'dan 'Ödedim' tuşlu hatırlatma gelir, tuşa basınca ödeme yazılır." : "If unchecked (expense): you get a Telegram reminder with a 'Paid' button."}</p>
    </>
  );
  const dialog = (
    <FormDialog trigger={trigger} title={L.recurring} action={saveRule} submit={L.add} className="group grid gap-3 sm:grid-cols-2">{form()}</FormDialog>
  );

  return (
    <div>
      <PageHeader title={L.recurring} actions={dialog} />
      {!rules?.length ? <EmptyState icon={Repeat} title={L.empty} action={dialog} /> : (
        <ul className="divide-y rounded-xl border bg-card shadow-xs">
          {rules.map((r) => {
            const acc = r.account as unknown as { name: string } | null;
            return (
              <li key={r.id} className={`flex flex-wrap items-center justify-between gap-3 p-4 text-sm ${r.active ? "" : "opacity-60"}`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{r.name}</span>
                    <Badge variant={r.auto_create ? "secondary" : "outline"}>{r.auto_create ? L.autoCreate : L.remindOnly}</Badge>
                    {!r.active ? <Badge variant="outline">{L.paused}</Badge> : null}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {acc?.name} · {catName(r.category_id)} · {L.dayOfMonth}: {r.day_of_month}
                    {r.active ? ` · ${L.nextRun}: ${nextDate(r.day_of_month, today)}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <span className={`mr-2 font-semibold tabular-nums ${r.kind === "income" ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
                    {r.kind === "income" ? "+" : r.kind === "transfer" ? "⇄ " : "−"}{fmt(Number(r.amount), r.currency as Currency, locale)}
                  </span>
                  <form action={toggleRule}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="active" value={String(!r.active)} />
                    <Button variant="ghost" size="sm" type="submit">{r.active ? <Pause className="size-4" /> : <Play className="size-4" />}{r.active ? L.pause : L.resume}</Button>
                  </form>
                  <FormDialog trigger={<Button variant="ghost" size="icon-sm" aria-label={L.edit} className="text-muted-foreground"><Pencil className="size-4" /></Button>}
                    title={`${r.name}: ${L.edit}`} action={saveRule} submit={L.save} className="group grid gap-3 sm:grid-cols-2">{form(r)}</FormDialog>
                  <ConfirmDelete action={removeRule} id={r.id} title={`${r.name}: ${L.remove}?`}
                    trigger={<Button variant="ghost" size="icon-sm" aria-label={L.remove} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-4" /></Button>} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

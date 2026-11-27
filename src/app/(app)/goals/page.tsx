import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getLocale, t } from "@/lib/i18n";
import { currentRate } from "@/lib/data";
import { fmt, toTry, type Currency } from "@/lib/money";
import { accountsWithBalance } from "@/lib/data";
import { goalProgress } from "@/lib/customize";
import { run } from "@/lib/action";
import { Plus, Target, Trash2, PlusCircle, Pencil } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { FormDialog } from "@/components/form-dialog";
import { ConfirmDelete } from "@/components/confirm-delete";
import { Button } from "@/components/ui/button";
import { Field, inputCls } from "@/components/field";

const num = (v: FormDataEntryValue | null) => Number(String(v ?? "").replace(",", "."));

// Ekle ya da düzenle (id varsa düzenler). Hesaba bağlı hedefte ilerleme o hesabın bakiyesinden gelir.
async function saveGoal(formData: FormData) {
  "use server";
  return run(async () => {
    const target = num(formData.get("target"));
    if (!(target > 0)) throw new Error("Hedef tutar 0'dan büyük olmalı.");
    const name = String(formData.get("name") ?? "").trim();
    if (!name) throw new Error("Hedef adı gerekli.");
    const row = {
      name, target_eur: target, saved_eur: Math.max(0, num(formData.get("saved")) || 0), currency: formData.get("currency") === "TRY" ? "TRY" : "EUR",
      target_date: String(formData.get("target_date") || "") || null, account_id: String(formData.get("account_id") || "") || null,
    };
    const supabase = await createClient();
    const id = String(formData.get("id") || "");
    const { error } = id ? await supabase.from("goals").update(row).eq("id", id) : await supabase.from("goals").insert(row);
    if (error) throw new Error(error.message);
    revalidatePath("/", "layout");
  });
}

async function contribute(formData: FormData) {
  "use server";
  return run(async () => {
    const add = num(formData.get("amount"));
    if (!add) throw new Error("Tutar gir (çıkarmak için eksi yaz).");
    const supabase = await createClient();
    const id = String(formData.get("id"));
    const { data: g } = await supabase.from("goals").select("saved_eur").eq("id", id).single();
    if (!g) throw new Error("Hedef bulunamadı.");
    const { error } = await supabase.from("goals").update({ saved_eur: Math.max(0, Number(g.saved_eur) + add) }).eq("id", id);
    if (error) throw new Error(error.message);
  });
}

async function removeGoal(formData: FormData) {
  "use server";
  const supabase = await createClient();
  await supabase.from("goals").delete().eq("id", String(formData.get("id")));
  revalidatePath("/", "layout");
}

export const metadata = { title: "Hedefler" };

export default async function GoalsPage() {
  const locale = await getLocale();
  const L = t(locale);
  const supabase = await createClient();
  const rate = await currentRate();
  const { data: goals } = await supabase.from("goals").select("*").order("created_at");
  const accounts = await accountsWithBalance();
  const tr = locale === "tr";
  const nowMs = new Date().getTime();
  const dual = (eur: number, c: Currency = "EUR") => (c === "EUR" ? `${fmt(eur, "EUR", locale)}${rate ? ` · ${fmt(toTry(eur, "EUR", rate), "TRY", locale)}` : ""}` : fmt(eur, "TRY", locale));

  const trigger = <Button size="sm"><Plus className="size-4" />{L.add}</Button>;
  type Goal = NonNullable<typeof goals>[number];
  const form = (g?: Goal) => (
    <>
      {g ? <input type="hidden" name="id" value={g.id} /> : null}
      <Field label={L.goalName} hint="Örn. Yaz tatili, Laptop" className="sm:col-span-2"><input name="name" required defaultValue={g?.name ?? ""} className={inputCls} /></Field>
      <Field label={L.target}><input name="target" required inputMode="decimal" defaultValue={g ? String(g.target_eur) : ""} className={inputCls} /></Field>
      <Field label={L.currency}>
        <select name="currency" defaultValue={g?.currency ?? "EUR"} className={inputCls}><option value="EUR">EUR</option><option value="TRY">TRY</option></select>
      </Field>
      <Field label={tr ? "Hesaba bağla" : "Link to account"} hint={tr ? "Seçersen ilerleme o hesabın bakiyesinden otomatik gelir (örn. Nakit Kenar)" : "Progress follows that account's balance"} className="sm:col-span-2">
        <select name="account_id" defaultValue={g?.account_id ?? ""} className={inputCls}>
          <option value="">{tr ? "— Bağlama, elle gireceğim" : "— None, I'll enter manually"}</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
        </select>
      </Field>
      <Field label={L.saved} hint={tr ? "Hesaba bağlı değilse biriken tutar" : "Used when not linked"}><input name="saved" inputMode="decimal" defaultValue={g ? String(g.saved_eur) : ""} placeholder="0" className={inputCls} /></Field>
      <Field label={L.targetDate} hint={L.optional}><input name="target_date" type="date" defaultValue={g?.target_date ?? ""} className={inputCls} /></Field>
    </>
  );
  const dialog = (
    <FormDialog trigger={trigger} title={L.goals} action={saveGoal} submit={L.add} className="grid gap-3 sm:grid-cols-2">{form()}</FormDialog>
  );

  return (
    <div>
      <PageHeader title={L.goals} actions={dialog} />
      {!goals?.length ? <EmptyState icon={Target} title={L.empty} action={dialog} /> : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {goals.map((g) => {
            const gp = goalProgress(g, accounts, rate);
            const target = gp.target, saved = gp.saved, cur = gp.currency;
            const pct = target > 0 ? Math.min(100, (saved / target) * 100) : 0;
            const monthsLeft = g.target_date ? Math.max(1, Math.ceil((new Date(g.target_date).getTime() - nowMs) / (30.44 * 86400000))) : null;
            const perMonth = monthsLeft && saved < target ? (target - saved) / monthsLeft : null;
            return (
              <li key={g.id} className="rounded-xl border bg-card p-5 shadow-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 font-medium">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted"><Target className="size-4" aria-hidden /></span>
                    <span className="truncate">{g.name}</span>
                  </span>
                  <span className="flex shrink-0">
                    <FormDialog trigger={<Button variant="ghost" size="icon-sm" aria-label={L.edit} className="text-muted-foreground"><Pencil className="size-4" /></Button>}
                      title={`${g.name}: ${L.edit}`} action={saveGoal} submit={L.save} className="grid gap-3 sm:grid-cols-2">{form(g)}</FormDialog>
                    <ConfirmDelete action={removeGoal} id={g.id} title={`${g.name}: ${L.remove}?`}
                      trigger={<Button variant="ghost" size="icon-sm" aria-label={L.remove} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-4" /></Button>} />
                  </span>
                </div>
                <div className="mt-4 flex items-baseline justify-between">
                  <span className="text-xl font-semibold tabular-nums">{fmt(saved, cur, locale)}</span>
                  <span className="text-sm text-muted-foreground">/ {fmt(target, cur, locale)} · {pct.toFixed(0)}%</span>
                </div>
                <div className="my-2 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                </div>
                <div className="text-xs text-muted-foreground">{dual(saved, cur)}{gp.linked ? ` · ${tr ? "hesaba bağlı" : "linked to account"}` : ""}</div>
                {perMonth ? <div className="mt-1 text-xs text-muted-foreground">{g.target_date}: {dual(perMonth, cur)} {L.perMonth}</div> : null}
                {gp.linked ? null : <div className="mt-4 border-t pt-3">
                  <FormDialog
                    trigger={<Button variant="outline" size="sm"><PlusCircle className="size-4" />{L.contribute}</Button>}
                    title={g.name} action={contribute} submit={L.contribute} className="grid gap-3"
                  >
                    <input type="hidden" name="id" value={g.id} />
                    <Field label={L.addedToGoal}><input name="amount" required inputMode="decimal" placeholder="+100" className={inputCls} /></Field>
                  </FormDialog>
                </div>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

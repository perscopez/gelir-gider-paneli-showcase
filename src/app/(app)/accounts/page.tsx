import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getLocale, t, type Dict } from "@/lib/i18n";
import { accountsWithBalance } from "@/lib/data";
import { fmt, type Currency } from "@/lib/money";
import { run } from "@/lib/action";
import { Pencil, Plus, Trash2, Wallet } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { FormDialog } from "@/components/form-dialog";
import { ConfirmDelete } from "@/components/confirm-delete";
import { AccountIcon } from "@/components/account-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, inputCls } from "@/components/field";

const num = (formData: FormData, k: string) => {
  const v = String(formData.get(k) ?? "").trim();
  return v ? Number(v.replace(",", ".")) : null;
};

const typeLabel = (L: Dict, type: string) =>
  ({ bank: L.typeBank, cash: L.typeCash, credit_card: L.typeCard, blocked: L.typeBlocked, reserve: L.typeReserve })[type] ?? type;

async function addAccount(formData: FormData) {
  "use server";
  return run(async () => {
    const name = String(formData.get("name") ?? "").trim();
    if (!name) throw new Error("Hesap adı gerekli.");
    const type = String(formData.get("type"));
    const supabase = await createClient();
    const { error } = await supabase.from("accounts").insert({
      name,
      institution: String(formData.get("institution") || "") || null,
      match_keys: String(formData.get("match_keys") || "").trim() || null,
      type,
      currency: String(formData.get("currency")),
      opening_balance: num(formData, "opening_balance") ?? 0,
      statement_day: type === "credit_card" ? num(formData, "statement_day") : null,
      due_day: type === "credit_card" ? num(formData, "due_day") : null,
      credit_limit: type === "credit_card" ? num(formData, "credit_limit") : null,
      blocked_end_date: type === "blocked" ? String(formData.get("blocked_end_date") || "") || null : null,
    });
    if (error) throw new Error(error.message);
  });
}

async function updateAccount(formData: FormData) {
  "use server";
  return run(async () => {
    const name = String(formData.get("name") ?? "").trim();
    if (!name) throw new Error("Hesap adı gerekli.");
    const supabase = await createClient();
    const id = String(formData.get("id"));
    const { data: cur } = await supabase.from("accounts").select("type").eq("id", id).single();
    if (!cur) throw new Error("Hesap bulunamadı.");
    // Banka ↔ nakit güvenle değişir. Kredi kartı / bloke / nakit kenar türleri geçmiş işlemlerin gelir-gider yorumunu değiştireceği için sabit.
    const newType = String(formData.get("type") || cur.type);
    const swappable = (x: string) => x === "bank" || x === "cash";
    const type = newType !== cur.type && swappable(newType) && swappable(cur.type) ? newType : cur.type;
    const { error } = await supabase.from("accounts").update({
      name,
      type,
      institution: String(formData.get("institution") || "") || null,
      match_keys: String(formData.get("match_keys") || "").trim() || null,
      opening_balance: num(formData, "opening_balance") ?? 0,
      statement_day: num(formData, "statement_day"),
      due_day: num(formData, "due_day"),
      credit_limit: num(formData, "credit_limit"),
      blocked_end_date: String(formData.get("blocked_end_date") || "") || null,
    }).eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/", "layout");
  });
}

async function archiveAccount(formData: FormData) {
  "use server";
  const supabase = await createClient();
  await supabase.from("accounts").update({ archived: true }).eq("id", String(formData.get("id")));
  revalidatePath("/", "layout");
}

export const metadata = { title: "Hesaplar" };

export default async function AccountsPage() {
  const locale = await getLocale();
  const L = t(locale);
  const accounts = await accountsWithBalance();
  // Açılış bakiyesi düzeltme geçmişi (ekstre eşitlemesi): tablo yoksa boş döner
  const { data: adjustments } = await (await createClient()).from("balance_adjustments")
    .select("id,as_of,delta,old_opening,new_opening,statement_balance,created_at,account:accounts(name,currency)").order("created_at", { ascending: false }).limit(10);
  const nowMs = new Date().getTime();
  const monthsLeft = (d: string) => Math.max(0, Math.round((new Date(d).getTime() - nowMs) / (30.44 * 86400000)));
  const only = (type: string) => `hidden group-has-[option[value=${type}]:checked]:contents`;

  const addButton = <Button size="sm"><Plus className="size-4" />{L.add}</Button>;

  return (
    <div>
      <PageHeader
        title={L.accounts}
        actions={
          <FormDialog trigger={addButton} title={L.accounts} action={addAccount} submit={L.add} className="group grid gap-3 sm:grid-cols-4">
            <Field label={L.name} hint={L.accountNameHint} className="sm:col-span-2">
              <input name="name" required className={inputCls} />
            </Field>
            <Field label={L.kind}>
              <select name="type" defaultValue="bank" className={inputCls}>
                <option value="bank">{L.typeBank}</option>
                <option value="cash">{L.typeCash}</option>
                <option value="credit_card">{L.typeCard}</option>
                <option value="blocked">{L.typeBlocked}</option>
                <option value="reserve">{L.typeReserve}</option>
              </select>
            </Field>
            <Field label={L.currency}>
              <select name="currency" defaultValue="EUR" className={inputCls}><option>EUR</option><option>TRY</option></select>
            </Field>
            <Field label={L.institution} className="sm:col-span-2">
              <input name="institution" className={inputCls} />
            </Field>
            <Field label={locale === "tr" ? "Eşleşme kelimeleri" : "Match keywords"} hint={locale === "tr" ? "Apple Pay / Gmail / ekstre bu hesabı hangi kelimelerden tanısın (örn. anka, fabrikam)" : "Words used to recognise this account"} className="sm:col-span-4">
              <input name="match_keys" className={inputCls} />
            </Field>
            <Field label={L.openingBalance} hint={L.amountHint} className="sm:col-span-2">
              <input name="opening_balance" inputMode="decimal" placeholder="0" className={inputCls} />
            </Field>
            <div className={only("credit_card")}>
              <Field label={L.statementDay}><input name="statement_day" type="number" min={1} max={31} className={inputCls} /></Field>
              <Field label={L.dueDay}><input name="due_day" type="number" min={1} max={31} className={inputCls} /></Field>
              <Field label={L.limit}><input name="credit_limit" inputMode="decimal" className={inputCls} /></Field>
            </div>
            <div className={only("blocked")}>
              <Field label={L.blockedEnds}><input name="blocked_end_date" type="date" className={inputCls} /></Field>
            </div>
          </FormDialog>
        }
      />

      {!accounts.length ? (
        <EmptyState icon={Wallet} title={L.empty} action={<FormDialog trigger={addButton} title={L.accounts} action={addAccount} submit={L.add} className="grid gap-3"><Field label={L.name}><input name="name" required className={inputCls} /></Field><input type="hidden" name="type" value="bank" /><input type="hidden" name="currency" value="EUR" /></FormDialog>} />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {accounts.map((a) => (
          <div key={a.id} className="rounded-xl border bg-card p-5 shadow-xs">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted"><AccountIcon type={a.type} className="size-5" /></span>
                <div className="min-w-0">
                  <div className="truncate font-medium">{a.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{a.institution ?? typeLabel(L, a.type)}</div>
                </div>
              </div>
              <Badge variant="secondary">{typeLabel(L, a.type)} · {a.currency}</Badge>
            </div>
            <div className={`mt-4 text-2xl font-semibold tabular-nums ${a.balance < 0 ? "text-destructive" : ""}`}>{fmt(a.balance, a.currency, locale)}</div>
            {a.type === "credit_card" && a.credit_limit ? (
              <div className="mt-1 text-xs text-muted-foreground">{L.limit}: {fmt(Number(a.credit_limit), a.currency, locale)}{a.due_day ? ` · ${L.due}: ${a.due_day}` : ""}</div>
            ) : null}
            {a.blocked_end_date ? <div className="mt-1 text-xs text-muted-foreground">{L.blockedEnds}: {a.blocked_end_date} (~{monthsLeft(a.blocked_end_date)} {L.monthsLeft})</div> : null}
            <div className="mt-4 flex items-center gap-1 border-t pt-3">
              <FormDialog
                trigger={<Button variant="ghost" size="sm" aria-label={L.edit}><Pencil className="size-4" />{L.edit}</Button>}
                title={a.name} action={updateAccount} submit={L.save} resetOnSuccess={false} className="grid gap-3"
              >
                <input type="hidden" name="id" value={a.id} />
                <Field label={L.name}><input name="name" required defaultValue={a.name} className={inputCls} /></Field>
                {a.type === "bank" || a.type === "cash" ? (
                  <Field label={L.kind}>
                    <select name="type" defaultValue={a.type} className={inputCls}><option value="bank">{L.typeBank}</option><option value="cash">{L.typeCash}</option></select>
                  </Field>
                ) : null}
                <Field label={L.institution}><input name="institution" defaultValue={a.institution ?? ""} className={inputCls} /></Field>
                <Field label={locale === "tr" ? "Eşleşme kelimeleri" : "Match keywords"} hint={locale === "tr" ? "Apple Pay / Gmail / ekstre bu hesabı bu kelimelerden de tanır. Hesabı yeniden adlandırsan da eşleşme bozulmaz (örn. anka, fabrikam)." : "Words used to recognise this account"}>
                  <input name="match_keys" defaultValue={a.match_keys ?? ""} className={inputCls} />
                </Field>
                <p className="text-xs text-muted-foreground">{locale === "tr" ? `Para birimi (${a.currency}) ve ${a.type === "credit_card" || a.type === "blocked" || a.type === "reserve" ? "hesap türü" : "kredi kartı/bloke türüne geçiş"} geçmiş işlemlerle tutarlı kalmak için değiştirilemez. Gerekirse yeni hesap açıp bunu arşivle.` : "Currency and special account types are locked to keep history consistent."}</p>
                <Field label={L.openingBalance} hint={L.amountHint}>
                  <input name="opening_balance" inputMode="decimal" defaultValue={a.opening_balance} className={inputCls} />
                </Field>
                {a.type === "credit_card" && (
                  <>
                    <Field label={L.statementDay}><input name="statement_day" type="number" min={1} max={31} defaultValue={a.statement_day ?? ""} className={inputCls} /></Field>
                    <Field label={L.dueDay}><input name="due_day" type="number" min={1} max={31} defaultValue={a.due_day ?? ""} className={inputCls} /></Field>
                    <Field label={L.limit}><input name="credit_limit" inputMode="decimal" defaultValue={a.credit_limit ?? ""} className={inputCls} /></Field>
                  </>
                )}
                {a.type === "blocked" && (
                  <Field label={L.blockedEnds}><input name="blocked_end_date" type="date" defaultValue={a.blocked_end_date ?? ""} className={inputCls} /></Field>
                )}
              </FormDialog>
              <ConfirmDelete
                action={archiveAccount} id={a.id} title={`${a.name}: ${L.archive}?`} confirm={L.archive}
                trigger={<Button variant="ghost" size="sm" className="ml-auto text-muted-foreground hover:text-destructive"><Trash2 className="size-4" />{L.archive}</Button>}
              />
            </div>
          </div>
        ))}
      </div>

      {adjustments?.length ? (
        <section className="mt-8 rounded-xl border bg-card p-5 shadow-xs">
          <h2 className="mb-1 font-medium">{locale === "tr" ? "Bakiye düzeltme geçmişi" : "Balance adjustment history"}</h2>
          <p className="mb-3 text-xs text-muted-foreground">{locale === "tr" ? "Ekstre işlendiğinde panel bakiyesi bankadaki bakiyeyle tutmadıysa açılış bakiyesi bu kadar düzeltildi." : "Opening balance corrections made when a statement was imported."}</p>
          <ul className="divide-y text-sm">
            {adjustments.map((a) => {
              const acc = a.account as unknown as { name: string; currency: Currency } | null;
              const cur = (acc?.currency ?? "EUR") as Currency;
              return (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0"><span className="font-medium">{acc?.name}</span> <span className="text-xs text-muted-foreground">· {locale === "tr" ? "ekstre tarihi" : "as of"} {a.as_of} · {new Date(a.created_at).toLocaleDateString(locale === "tr" ? "tr-TR" : "en-GB")}</span></span>
                  <span className="tnum text-xs text-muted-foreground">{fmt(Number(a.old_opening), cur, locale)} → {fmt(Number(a.new_opening), cur, locale)} <span className={Number(a.delta) < 0 ? "font-medium text-destructive" : "font-medium"}>({Number(a.delta) > 0 ? "+" : ""}{fmt(Number(a.delta), cur, locale)})</span></span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

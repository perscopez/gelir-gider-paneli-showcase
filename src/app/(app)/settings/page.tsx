import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getLocale, t } from "@/lib/i18n";
import { Download, LogOut, Pencil, Plus, Trash2 } from "lucide-react";
import { run } from "@/lib/action";
import { PageHeader } from "@/components/page-header";
import { FormDialog } from "@/components/form-dialog";
import { ConfirmDelete } from "@/components/confirm-delete";
import { CategoryIcon } from "@/components/category-icon";
import { Field, inputCls } from "@/components/field";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DEFAULT_CATEGORIES: [string, string, "income" | "expense"][] = [
  ["Bloke hesap ödemesi", "Blocked account payout", "income"], ["Aile desteği", "Family support", "income"],
  ["Freelance / iş", "Freelance / work", "income"], ["Diğer gelir", "Other income", "income"],
  ["Kira", "Rent", "expense"], ["Market", "Groceries", "expense"], ["Dışarıda yemek", "Eating out", "expense"],
  ["Ulaşım", "Transport", "expense"], ["Faturalar", "Bills", "expense"], ["Abonelikler", "Subscriptions", "expense"],
  ["Sağlık", "Health", "expense"], ["Alışveriş", "Shopping", "expense"], ["Eğlence", "Entertainment", "expense"],
  ["Seyahat", "Travel", "expense"], ["Eğitim", "Education", "expense"], ["Diğer gider", "Other expense", "expense"],
];

async function setLocale(formData: FormData) {
  "use server";
  (await cookies()).set("locale", formData.get("locale") === "en" ? "en" : "tr", { path: "/", maxAge: 31536000 });
  revalidatePath("/", "layout");
}

async function seedCategories() {
  "use server";
  const supabase = await createClient();
  const { count } = await supabase.from("categories").select("id", { count: "exact", head: true });
  if (count) return;
  await supabase.from("categories").insert(DEFAULT_CATEGORIES.map(([name_tr, name_en, kind]) => ({ name_tr, name_en, kind })));
  revalidatePath("/", "layout");
}

async function signOut() {
  "use server";
  await (await createClient()).auth.signOut();
  redirect("/login");
}

async function addCategory(formData: FormData) {
  "use server";
  return run(async () => {
    const name_tr = String(formData.get("name_tr") ?? "").trim();
    const name_en = String(formData.get("name_en") ?? "").trim() || name_tr;
    if (!name_tr) throw new Error("Kategori adı gerekli.");
    const supabase = await createClient();
    const { error } = await supabase.from("categories").insert({ name_tr, name_en, kind: formData.get("kind") === "income" ? "income" : "expense" });
    if (error) throw new Error(error.message);
  });
}

// Yeniden adlandır: yerleşik anahtar (builtin_key) korunur, böylece otomatik kategorileme (Market, Kira...) yeni adla da çalışır.
async function updateCategory(formData: FormData) {
  "use server";
  return run(async () => {
    const name_tr = String(formData.get("name_tr") ?? "").trim();
    const name_en = String(formData.get("name_en") ?? "").trim() || name_tr;
    if (!name_tr) throw new Error("Kategori adı gerekli.");
    const supabase = await createClient();
    const { error } = await supabase.from("categories").update({ name_tr, name_en }).eq("id", String(formData.get("id")));
    if (error) throw new Error(error.message);
    revalidatePath("/", "layout");
  });
}

async function removeCategory(formData: FormData) {
  "use server";
  const supabase = await createClient();
  await supabase.from("categories").delete().eq("id", String(formData.get("id")));
  revalidatePath("/", "layout");
}

export const metadata = { title: "Ayarlar" };

export default async function SettingsPage() {
  const locale = await getLocale();
  const L = t(locale);
  const supabase = await createClient();
  const { data: cats } = await supabase.from("categories").select("id,name_tr,name_en,kind,icon").order("kind").order("name_tr");
  const card = "rounded-xl border bg-card p-5 shadow-xs";
  const label = (c: { name_tr: string; name_en: string }) => (locale === "tr" ? c.name_tr : c.name_en);

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title={L.settings} />

      <section className={card}>
        <h2 className="mb-3 font-medium">{L.language}</h2>
        <form action={setLocale} className="flex items-center gap-3">
          <select name="locale" defaultValue={locale} className={cn(inputCls, "w-auto")} aria-label={L.language}>
            <option value="tr">Türkçe</option><option value="en">English</option>
          </select>
          <Button type="submit" variant="outline">{L.save}</Button>
        </form>
      </section>

      <section className={card}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-medium">{locale === "tr" ? "Kategoriler" : "Categories"}</h2>
          <div className="flex items-center gap-2">
            {!cats?.length && (
              <form action={seedCategories}><Button type="submit" variant="outline" size="sm">{locale === "tr" ? "Varsayılanları ekle" : "Add defaults"}</Button></form>
            )}
            <FormDialog trigger={<Button size="sm"><Plus className="size-4" />{L.add}</Button>}
              title={locale === "tr" ? "Yeni kategori" : "New category"} action={addCategory} submit={L.add} className="grid gap-3">
              <Field label={locale === "tr" ? "Ad (Türkçe)" : "Name (Turkish)"}><input name="name_tr" required className={inputCls} /></Field>
              <Field label={locale === "tr" ? "Ad (İngilizce)" : "Name (English)"} hint={L.optional}><input name="name_en" className={inputCls} /></Field>
              <Field label={L.kind}>
                <select name="kind" defaultValue="expense" className={inputCls}>
                  <option value="expense">{L.kindExpense}</option><option value="income">{L.kindIncome}</option>
                </select>
              </Field>
            </FormDialog>
          </div>
        </div>
        {!cats?.length ? <p className="text-sm text-muted-foreground">{L.empty}</p> : (
          <ul className="grid gap-1 sm:grid-cols-2">
            {cats.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/60">
                <span className="flex min-w-0 items-center gap-2">
                  <CategoryIcon name={c.icon} kind={c.kind} className="size-4 shrink-0" />
                  <span className="truncate">{label(c)}</span>
                  <Badge variant="outline" className="shrink-0">{c.kind === "income" ? L.kindIncome : L.kindExpense}</Badge>
                </span>
                <span className="flex shrink-0">
                <FormDialog trigger={<Button variant="ghost" size="icon-sm" aria-label={L.edit} className="text-muted-foreground"><Pencil className="size-4" /></Button>}
                  title={`${label(c)}: ${L.edit}`} action={updateCategory} submit={L.save} className="grid gap-3">
                  <input type="hidden" name="id" value={c.id} />
                  <Field label={locale === "tr" ? "Ad (Türkçe)" : "Name (Turkish)"}><input name="name_tr" required defaultValue={c.name_tr} className={inputCls} /></Field>
                  <Field label={locale === "tr" ? "Ad (İngilizce)" : "Name (English)"} hint={L.optional}><input name="name_en" defaultValue={c.name_en} className={inputCls} /></Field>
                  <p className="text-xs text-muted-foreground">{locale === "tr" ? "Adı değiştirmek işlemleri, bütçeleri ve kuralları bozmaz; hepsi aynı kategoriye bağlı kalır." : "Renaming keeps transactions, budgets and rules attached."}</p>
                </FormDialog>
                <ConfirmDelete action={removeCategory} id={c.id} title={`${label(c)}: ${L.remove}?`}
                  description={locale === "tr" ? "Bu kategorideki işlemler kategorisiz kalır; bu kategorinin bütçeleri ve otomatik kategori kuralları silinir." : "Transactions become uncategorized; this category's budgets and rules are deleted."}
                  trigger={<Button variant="ghost" size="icon-sm" aria-label={L.remove} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-4" /></Button>} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={card}>
        <h2 className="mb-3 font-medium">{locale === "tr" ? "Veri ve oturum" : "Data and session"}</h2>
        <p className="mb-3 text-sm text-muted-foreground">{locale === "tr" ? "Tam yedek: hesaplar, kategoriler, kurallar, tekrarlayanlar, bütçeler, hedefler, işlemler ve fiş kalemleri. Her hafta otomatik de alınır (son 8 yedek saklanır, Telegram'a bildirilir)." : "Full backup of everything. Also taken automatically every week."}</p>
        <div className="flex flex-wrap gap-2">
          <a href="/api/export/transactions" className={cn(buttonVariants({ variant: "outline" }))}><Download className="size-4" />{L.exportCsv}</a>
          <a href="/api/export/backup" className={cn(buttonVariants({ variant: "outline" }))}><Download className="size-4" />{locale === "tr" ? "Tam yedek indir (JSON)" : "Full backup (JSON)"}</a>
          <form action={signOut}><Button type="submit" variant="ghost"><LogOut className="size-4" />{L.signOut}</Button></form>
        </div>
      </section>
    </div>
  );
}

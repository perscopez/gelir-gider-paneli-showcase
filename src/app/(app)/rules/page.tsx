import Link from "next/link";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getLocale, t } from "@/lib/i18n";
import { run } from "@/lib/action";
import { Pencil, Plus, Tags, Trash2, Wand2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { FormDialog } from "@/components/form-dialog";
import { ConfirmDelete } from "@/components/confirm-delete";
import { Button } from "@/components/ui/button";
import { Field, Notice, inputCls } from "@/components/field";

// Kategorisiz mevcut işlemlerden açıklaması eşleşenleri, kategorinin türüne uyanlara (gider/gelir) atar. Atanan sayıyı döner.
async function applyPattern(supabase: Awaited<ReturnType<typeof createClient>>, pattern: string, categoryId: string): Promise<number> {
  const { data: c } = await supabase.from("categories").select("kind").eq("id", categoryId).single();
  if (!c) return 0;
  const esc = pattern.replace(/[\\%_]/g, "\\$&");
  const { data } = await supabase.from("transactions").update({ category_id: categoryId })
    .is("category_id", null).eq("kind", c.kind).ilike("merchant", `%${esc}%`).select("id");
  return data?.length ?? 0;
}

// Ekle ya da düzenle (id varsa düzenler). "Geçmişe de uygula" işaretliyse kategorisiz eski işlemler de güncellenir.
async function saveRule(formData: FormData) {
  "use server";
  return run(async () => {
    const pattern = String(formData.get("pattern") ?? "").trim().toLowerCase();
    if (!pattern) throw new Error("Metin gerekli.");
    const supabase = await createClient();
    const row = { pattern, category_id: String(formData.get("category_id")) };
    const id = String(formData.get("id") || "");
    const { error } = id ? await supabase.from("category_rules").update(row).eq("id", id) : await supabase.from("category_rules").insert(row);
    if (error) throw new Error(error.message);
    if (formData.get("apply") === "on") await applyPattern(supabase, pattern, row.category_id);
    revalidatePath("/", "layout");
  });
}

async function removeRule(formData: FormData) {
  "use server";
  const supabase = await createClient();
  await supabase.from("category_rules").delete().eq("id", String(formData.get("id")));
  revalidatePath("/", "layout");
}

async function applyRule(formData: FormData) {
  "use server";
  const supabase = await createClient();
  await applyPattern(supabase, String(formData.get("pattern")), String(formData.get("category_id")));
  revalidatePath("/", "layout");
}

export const metadata = { title: "Kurallar" };

export default async function RulesPage() {
  const locale = await getLocale();
  const L = t(locale);
  const supabase = await createClient();
  const [{ data: cats }, { data: rules }, { count: uncategorized }] = await Promise.all([
    supabase.from("categories").select("id,name_tr,name_en").order("name_tr"),
    supabase.from("category_rules").select("id,pattern,category_id").order("created_at"),
    supabase.from("transactions").select("id", { count: "exact", head: true }).is("category_id", null).neq("kind", "transfer"),
  ]);
  const catName = (id: string) => {
    const c = cats?.find((x) => x.id === id);
    return c ? (locale === "tr" ? c.name_tr : c.name_en) : L.none;
  };

  if (!cats?.length) {
    return (
      <>
        <PageHeader title={L.rules} description={L.rulesHint} />
        <Notice>{L.needCategory} <Link href="/settings" className="underline">{L.goSettings}</Link></Notice>
      </>
    );
  }

  const trigger = <Button size="sm"><Plus className="size-4" />{L.add}</Button>;
  type CatRule = NonNullable<typeof rules>[number];
  const form = (r?: CatRule) => (
    <>
      {r ? <input type="hidden" name="id" value={r.id} /> : null}
      <Field label={L.pattern} hint="Büyük/küçük harf fark etmez"><input name="pattern" required defaultValue={r?.pattern ?? ""} className={inputCls} /></Field>
      <Field label={L.category}>
        <select name="category_id" required defaultValue={r?.category_id} className={inputCls}>
          {cats.map((c) => <option key={c.id} value={c.id}>{locale === "tr" ? c.name_tr : c.name_en}</option>)}
        </select>
      </Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="apply" defaultChecked /> {locale === "tr" ? "Geçmişteki kategorisiz işlemlere de uygula" : "Also apply to past uncategorized transactions"}</label>
    </>
  );
  const dialog = <FormDialog trigger={trigger} title={L.rules} action={saveRule} submit={L.add} className="grid gap-3">{form()}</FormDialog>;

  return (
    <div>
      <PageHeader title={L.rules} description={`${L.rulesHint} ${L.uncategorized}: ${uncategorized ?? 0}`} actions={dialog} />
      {!rules?.length ? <EmptyState icon={Tags} title={L.empty} action={dialog} /> : (
        <ul className="divide-y rounded-xl border bg-card shadow-xs">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
              <div className="min-w-0"><span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{r.pattern}</span> <span className="text-muted-foreground">→</span> <span className="font-medium">{catName(r.category_id)}</span></div>
              <div className="flex items-center gap-1">
                <form action={applyRule}>
                  <input type="hidden" name="pattern" value={r.pattern} />
                  <input type="hidden" name="category_id" value={r.category_id} />
                  <Button variant="ghost" size="sm" type="submit"><Wand2 className="size-4" />{L.applyExisting}</Button>
                </form>
                <FormDialog trigger={<Button variant="ghost" size="icon-sm" aria-label={L.edit} className="text-muted-foreground"><Pencil className="size-4" /></Button>}
                  title={`${r.pattern}: ${L.edit}`} action={saveRule} submit={L.save} className="grid gap-3">{form(r)}</FormDialog>
                <ConfirmDelete action={removeRule} id={r.id} title={`${r.pattern}: ${L.remove}?`}
                  trigger={<Button variant="ghost" size="icon-sm" aria-label={L.remove} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-4" /></Button>} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

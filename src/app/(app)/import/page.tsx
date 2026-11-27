import { createClient } from "@/lib/supabase/server";
import { getLocale, t } from "@/lib/i18n";
import { PageHeader } from "@/components/page-header";
import { ImportWizard } from "./import-wizard";

export const metadata = { title: "İçe aktar" };

export default async function ImportPage() {
  const locale = await getLocale();
  const L = t(locale);
  const supabase = await createClient();
  const [{ data: accounts }, { data: categories }] = await Promise.all([
    supabase.from("accounts").select("id,name,currency,type").eq("archived", false).not("type", "in", "(blocked,reserve)").order("sort_order").order("created_at"),
    supabase.from("categories").select("id,name_tr,name_en,kind").order("name_tr"),
  ]);
  return (
    <div>
      <PageHeader title={L.importNav} description={L.importHint} />
      <ImportWizard accounts={accounts ?? []} categories={(categories ?? []) as never} locale={locale} />
    </div>
  );
}

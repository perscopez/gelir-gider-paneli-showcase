import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getLocale, t } from "@/lib/i18n";
import { AppShell } from "@/components/shell/app-shell";
import { FormDialog } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { addTransaction } from "./transactions/actions";
import { TransactionFields } from "./transactions/transaction-fields";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const L = t(locale);
  const supabase = await createClient();
  const [{ data: accounts }, { data: categories }] = await Promise.all([
    supabase.from("accounts").select("id,name,currency,type").eq("archived", false).order("sort_order").order("created_at"),
    supabase.from("categories").select("id,name_tr,name_en,kind").order("name_tr"),
  ]);

  const quickAdd = accounts?.length ? (
    <FormDialog
      trigger={<Button size="sm"><Plus className="size-4" /><span className="hidden sm:inline">{L.newTransaction}</span></Button>}
      title={L.newTransaction}
      action={addTransaction}
      submit={L.add}
    >
      <TransactionFields accounts={accounts} categories={categories ?? []} locale={locale} L={L} />
    </FormDialog>
  ) : null;

  return <AppShell quickAdd={quickAdd}>{children}</AppShell>;
}

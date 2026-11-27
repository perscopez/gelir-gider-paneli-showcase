import { createClient } from "@/lib/supabase/server";
import { buildBackup } from "@/lib/backup";
import { todayISO } from "@/lib/date";

export const maxDuration = 60;

// Tam yedeği (hesaplar, kategoriler, kurallar, tekrarlayanlar, bütçeler, hedefler, işlemler, fiş kalemleri, ürün eşleşmeleri, bakiye düzeltmeleri) JSON olarak indirir.
// Oturum gerekir (proxy korur); RLS yalnız sahibin satırlarını verir.
export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new Response("unauthorized", { status: 401 });
  const backup = await buildBackup(supabase);
  return new Response(JSON.stringify(backup, null, 1), {
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="yedek-${todayISO()}.json"`, "cache-control": "no-store" },
  });
}

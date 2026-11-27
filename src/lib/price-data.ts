import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/paginate";
import { addDaysISO, todayISO } from "@/lib/date";
import { buildIndex, type PriceIndex, type PricePoint } from "@/lib/price-verdict";

// Son `days` günün fiş kalemlerinden ürün fiyat endeksi (yalnızca € ve birim fiyatı hesaplanmış kalemler). Tablo yoksa boş endeks döner.
// `uid`: servis anahtarıyla çalışırken (Telegram) satırlar o kullanıcıya göre süzülür; oturumlu istemcide RLS zaten süzer.
export async function loadPriceIndex(db: SupabaseClient, days = 365, uid?: string): Promise<PriceIndex> {
  try {
    const since = addDaysISO(todayISO(), -days);
    const rows = await fetchAll<{ transaction_id: string; product: string | null; base_unit: string | null; price_per_base: number | string | null; merchant: string | null; purchased_on: string | null }>((a, b) =>
      (uid ? db.from("receipt_items").select("transaction_id,product,base_unit,price_per_base,merchant,purchased_on").eq("user_id", uid) : db.from("receipt_items").select("transaction_id,product,base_unit,price_per_base,merchant,purchased_on"))
        .eq("currency", "EUR").gt("price_per_base", 0).not("product", "is", null).not("base_unit", "is", null).gte("purchased_on", since)
        .order("purchased_on", { ascending: false }).order("id").range(a, b));
    const pts: PricePoint[] = rows.map((r) => ({ txn: r.transaction_id, product: r.product!, unit: r.base_unit!, price: Number(r.price_per_base), merchant: r.merchant, date: r.purchased_on ?? "" }));
    return buildIndex(pts);
  } catch {
    return buildIndex([]);
  }
}

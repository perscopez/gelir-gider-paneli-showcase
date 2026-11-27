import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/paginate";

// Tam JSON yedek: tüm kullanıcı tabloları. Eksik tablo (migration çalıştırılmamış) hata vermez, "missing" listesine yazılır.
export const BACKUP_TABLES = [
  "accounts", "categories", "category_rules", "recurring_rules", "budgets", "goals", "transactions", "receipt_items", "product_aliases", "balance_adjustments", "notifications",
] as const;

export type Backup = {
  version: 1; created_at: string; counts: Record<string, number>; missing: string[];
  tables: Record<string, unknown[]>; fx_rates: unknown[];
};

// `uid` verilirse (servis anahtarıyla çalışan cron) satırlar o kullanıcıya göre süzülür; oturumlu istemcide RLS zaten yalnız sahibin satırlarını verir.
export async function buildBackup(db: SupabaseClient, uid?: string): Promise<Backup> {
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  const missing: string[] = [];
  for (const t of BACKUP_TABLES) {
    try {
      tables[t] = await fetchAll<unknown>((a, b) => {
        const q = db.from(t).select("*");
        return (uid ? q.eq("user_id", uid) : q).order("id").range(a, b);
      });
      counts[t] = tables[t].length;
    } catch {
      missing.push(t);
    }
  }
  let fx: unknown[] = [];
  try { fx = await fetchAll<unknown>((a, b) => db.from("fx_rates").select("*").order("day").range(a, b)); } catch { /* isteğe bağlı */ }
  return { version: 1, created_at: new Date().toISOString(), counts, missing, tables, fx_rates: fx };
}

export const summarizeBackup = (b: Backup) =>
  Object.entries(b.counts).filter(([, n]) => n > 0).map(([t, n]) => `${t} ${n}`).join(" · ");

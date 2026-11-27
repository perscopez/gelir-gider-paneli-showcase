import type { SupabaseClient } from "@supabase/supabase-js";
import { addMonthsKey } from "@/lib/date";

export type Filters = { q: string; month: string; account: string; category: string; kind: string; page: number };
export const PAGE_SIZE = 25;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const uuid = /^[0-9a-f-]{36}$/i;

export function parseFilters(sp: Record<string, string | string[] | undefined>, defaultMonth: string): Filters {
  const month = one(sp.month);
  return {
    q: one(sp.q).replace(/[,()%_\\*]/g, " ").trim().slice(0, 60),
    month: month === "all" ? "" : /^\d{4}-\d{2}$/.test(month) ? month : defaultMonth,
    account: uuid.test(one(sp.account)) ? one(sp.account) : "",
    category: uuid.test(one(sp.category)) || one(sp.category) === "none" ? one(sp.category) : "",
    kind: ["income", "expense", "transfer"].includes(one(sp.kind)) ? one(sp.kind) : "",
    page: Math.max(1, Number(one(sp.page)) || 1),
  };
}

// Filtreleri uygular (RLS zaten sadece sahibin satırlarını döndürür).
export function filteredTransactions(supabase: SupabaseClient, select: string, f: Filters, count = false) {
  let q = supabase.from("transactions").select(select, count ? { count: "exact" } : undefined);
  if (f.month) q = q.gte("occurred_on", `${f.month}-01`).lt("occurred_on", `${addMonthsKey(f.month, 1)}-01`);
  if (f.q) q = q.or(`merchant.ilike.%${f.q}%,note.ilike.%${f.q}%`);
  if (f.account) q = q.or(`account_id.eq.${f.account},to_account_id.eq.${f.account}`);
  if (f.category === "none") q = q.is("category_id", null).neq("kind", "transfer");
  else if (f.category) q = q.eq("category_id", f.category);
  if (f.kind) q = q.eq("kind", f.kind);
  return q;
}

export const toQuery = (f: Partial<Filters> & Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== "" && !(k === "page" && v === 1)) p.set(k, String(v));
  return p.toString();
};

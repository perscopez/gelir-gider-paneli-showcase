import { createClient } from "@/lib/supabase/server";
import type { Currency } from "@/lib/money";

export async function currentRate(): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase.from("fx_rates").select("eur_try").order("day", { ascending: false }).limit(1).maybeSingle();
  return data ? Number(data.eur_try) : 0;
}

export type AccountRow = {
  id: string; name: string; institution: string | null; type: string; currency: Currency;
  statement_day: number | null; due_day: number | null; credit_limit: number | null; blocked_end_date: string | null;
  opening_balance: number; match_keys?: string | null;
  balance: number;
};

export async function accountsWithBalance(): Promise<AccountRow[]> {
  const supabase = await createClient();
  const [{ data: accs }, { data: bals }] = await Promise.all([
    supabase.from("accounts").select("*").eq("archived", false).order("sort_order").order("created_at"),
    supabase.from("account_balances").select("account_id,balance"),
  ]);
  const map = new Map((bals ?? []).map((b) => [b.account_id, Number(b.balance)]));
  return (accs ?? []).map((a) => ({ ...a, balance: map.get(a.id) ?? 0 }));
}

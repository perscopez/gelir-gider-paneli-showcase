import type { SupabaseClient } from "@supabase/supabase-js";
import { balanceFrom, type BalanceRow } from "@/lib/balance";
import { fetchAll } from "@/lib/paginate";

// Ekstre bakiyesi gerçektir: hesabın `asOf` tarihindeki panel bakiyesi ekstredeki bakiyeyle tutmuyorsa açılış bakiyesi aradaki farkla düzeltilir.
// Böylece hesap açılmadan önceki işlemler (geriye dönük ekstre) ya da hiç bildirimi gelmemiş işlemler bakiyeyi sonsuza dek kaydırmaz. Tutarsa hiçbir şey değişmez.
// Kesim/üretim günündeki işlemler belirsizdir: başka bir (daha sonraki) ekstrenin satırı olan kayıtlar o gün BU ekstrenin bakiyesine sayılmaz (ekstre kesildikten sonra o güne yazılmışlardır).
export async function syncOpeningToStatement(db: SupabaseClient, accountId: string, asOf: string, target: number, statementIds: Set<string>, prefix: string): Promise<{ delta: number; skipped?: boolean }> {
  // Yalnızca EN YENİ ekstre eşitler: bu hesapta asOf tarihinden sonra başka bir ekstreden gelmiş kayıt varsa (eski bir ekstre sonradan yüklendi), güncel bakiyeyi bozmamak için atlanır.
  const { count: newer } = await db.from("transactions").select("id", { count: "exact", head: true })
    .or(`account_id.eq.${accountId},to_account_id.eq.${accountId}`).like("external_id", `${prefix}%`).gt("occurred_on", asOf);
  if ((newer ?? 0) > 0) return { delta: 0, skipped: true };
  const [{ data: acc }, rows] = await Promise.all([
    db.from("accounts").select("opening_balance,user_id").eq("id", accountId).single(),
    fetchAll<BalanceRow & { occurred_on: string; external_id: string | null }>((a, b) => db.from("transactions").select("kind,amount,to_amount,account_id,to_account_id,occurred_on,external_id")
      .or(`account_id.eq.${accountId},to_account_id.eq.${accountId}`).lte("occurred_on", asOf).order("occurred_on").order("id").range(a, b)),
  ]);
  if (!acc) return { delta: 0 };
  const laterStatementRow = (r: { external_id: string | null }) => r.external_id !== null && /^(vk|vb|vh|qk):/.test(r.external_id) && !statementIds.has(r.external_id);
  const counted = rows.filter((r) => r.occurred_on < asOf || !laterStatementRow(r));
  const opening = Number(acc.opening_balance);
  const delta = Math.round((target - balanceFrom(opening, accountId, counted)) * 100) / 100;
  if (Math.abs(delta) > 0.005) {
    const newOpening = Math.round((opening + delta) * 100) / 100;
    await db.from("accounts").update({ opening_balance: newOpening }).eq("id", accountId);
    // Denetim izi: açılış bakiyesi ne zaman, ne kadar düzeltildi (tablo yoksa sessizce atlanır).
    await db.from("balance_adjustments").insert({ user_id: acc.user_id, account_id: accountId, as_of: asOf, statement_balance: target, old_opening: opening, new_opening: newOpening, delta, source: "statement" });
  }
  return { delta };
}

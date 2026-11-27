import type { SupabaseClient } from "@supabase/supabase-js";

// Çok adımlı yazımlar Postgres fonksiyonlarıyla (supabase/migrations/0008) tek veritabanı işleminde yapılır: ağ kopsa ya da bir adım hata verse bile yarım kayıt kalmaz.
// 0008 henüz çalıştırılmadıysa (fonksiyon yok) eski sıralı yola düşülür, uygulama bozulmaz.
const fnMissing = (e: { code?: string; message?: string } | null) => !!e && (e.code === "PGRST202" || e.code === "42883" || /could not find the function|schema cache/i.test(e.message ?? ""));

export type Row = Record<string, unknown>;
export type Update = { id: string; patch: Row };

// Ekstre uygulaması: yeni işlemler + mevcut kayıtların güncellenmesi (bağla / gerçek tutara düzelt / karta transfere çevir).
export async function applyStatement(db: SupabaseClient, inserts: Row[], updates: Update[]): Promise<void> {
  if (!inserts.length && !updates.length) return;
  const { error } = await db.rpc("apply_statement", { p_inserts: inserts, p_updates: updates });
  if (!error) return;
  if (!fnMissing(error)) throw new Error(error.message);
  if (inserts.length) {
    const r = await db.from("transactions").insert(inserts);
    if (r.error) throw new Error(r.error.message);
  }
  for (const u of updates) await db.from("transactions").update(u.patch).eq("id", u.id);
}

// İşlem + fiş kalemleri. Kalem yoksa düz ekleme. `txn.id` verilmelidir (kalemler eski yolda ona bağlanır).
export async function insertTxnWithItems(db: SupabaseClient, txn: Row & { id: string }, items: Row[]): Promise<string> {
  if (!items.length) {
    const { data, error } = await db.from("transactions").insert(txn).select("id").single();
    if (error) throw new Error(error.message);
    return data.id as string;
  }
  const { data, error } = await db.rpc("insert_txn_with_items", { p_txn: txn, p_items: items });
  if (!error) return data as string;
  if (!fnMissing(error)) throw new Error(error.message);
  const ins = await db.from("transactions").insert(txn).select("id").single();
  if (ins.error) throw new Error(ins.error.message);
  const it = await db.from("receipt_items").insert(items.map((i) => ({ ...i, transaction_id: txn.id })));
  if (it.error) { await db.from("transactions").delete().eq("id", txn.id); throw new Error(it.error.message); }
  return ins.data.id as string;
}

// Var olan işleme fiş (yol, kategori, not) ve kalemleri bağlar.
export async function attachReceipt(db: SupabaseClient, txnId: string, patch: Row, items: Row[]): Promise<void> {
  const { error } = await db.rpc("receipt_attach", { p_txn_id: txnId, p_patch: patch, p_items: items });
  if (!error) return;
  if (!fnMissing(error)) throw new Error(error.message);
  const up = await db.from("transactions").update(patch).eq("id", txnId);
  if (up.error) throw new Error(up.error.message);
  if (items.length) {
    const it = await db.from("receipt_items").insert(items.map((i) => ({ ...i, transaction_id: txnId })));
    if (it.error) throw new Error(it.error.message);
  }
}

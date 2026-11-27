import { categoryIdByKey } from "@/lib/customize";
import { insertTxnWithItems } from "@/lib/atomic";
import { adminClient, ownerId } from "@/lib/supabase/admin";
import { UserFacingError } from "@/lib/errors";
import { rateForDate } from "@/lib/fx";
import { todayISO } from "@/lib/date";
import { suggestCategoryName } from "@/lib/statements/categorize";
import { toEur, toTry, type Currency } from "@/lib/money";

export type QuickTxn = {
  kind: "income" | "expense";
  amount: number;
  currency?: Currency;
  merchant?: string;
  accountHint?: string; // hesap veya kart adı ("Fabrikam Mastercard", "lale", "nakit")
  source: "telegram" | "apple_pay" | "email" | "csv";
  externalId?: string;
  occurredOn?: string;
  // Fiş akışı için
  id?: string; // önceden üretilmiş işlem kimliği (fiş dosyasının yolu için)
  accountId?: string;
  cashReceiptBackfill?: boolean;
  receiptFileKey?: string;
  preferCash?: boolean; // ipucu yoksa nakit hesabı tercih et
  categoryName?: string; // fişten okunan kategori (kullanıcı kategorilerinden biri)
  receiptPath?: string;
  note?: string;
  items?: Record<string, unknown>[]; // fiş kalemleri: işlemle birlikte tek veritabanı işleminde yazılır (atomik)
};

const tokens = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9ğüşıöçâîû]+/g, " ").split(" ").filter((w) => w.length >= 3);

type Account = { id: string; name: string; institution: string | null; currency: string; type: string; match_keys?: string | null };

// Kart/hesap adını eşleştirir: ortak kelime sayısı en yüksek hesap kazanır ("Fabrikam Mastercard" → "Fabrikam Banka").
function pickAccount(accounts: Account[], hint: string | undefined, currency: Currency | undefined, preferCash = false): Account {
  const usable = accounts.filter((a) => a.type !== "blocked" && a.type !== "reserve");
  if (hint) {
    const h = tokens(hint);
    let best: Account | undefined;
    let bestScore = 0;
    for (const a of usable) {
      const t = tokens(`${a.name} ${a.institution ?? ""} ${a.match_keys ?? ""}`);
      const score = h.filter((w) => t.some((x) => x.includes(w) || w.includes(x))).length;
      if (score > bestScore) { best = a; bestScore = score; }
    }
    if (best) return best;
  }
  if (preferCash) {
    const cash = usable.filter((a) => a.type === "cash");
    const hit = (currency ? cash.find((a) => a.currency === currency) : undefined) ?? cash[0];
    if (hit) return hit;
  }
  const cards = usable.filter((a) => a.type !== "cash");
  return (currency ? cards.find((a) => a.currency === currency) : undefined) ?? cards[0] ?? usable[0] ?? accounts[0];
}

// Webhook/bot kaynaklı işlemi kaydeder: hesabı tahmin eder, kategoriyi (kural → yerleşik sözlük) belirler, kuru yazar.
export async function recordQuickTxn(q: QuickTxn) {
  const db = adminClient();
  const uid = ownerId();
  const { data: accounts } = await db.from("accounts").select("*").eq("user_id", uid).eq("archived", false);
  if (!accounts?.length) throw new UserFacingError("Henüz hiç hesabın yok. Önce panelde Hesaplar sayfasından bir hesap ekle.");

  const account = q.accountId ? accounts.find((a) => a.id === q.accountId) : pickAccount(accounts, q.accountHint, q.currency, q.preferCash);
  if (!account) throw new UserFacingError("Seçilen hesap bulunamadı.");
  const currency = account.currency as Currency;
  const rate = await rateForDate(db, q.occurredOn ?? todayISO());

  // İşlem para birimi hesabınkinden farklıysa (örn. EUR kartla TL harcama) hesabın para birimine çevir.
  let amount = q.amount;
  let note: string | null = q.note ?? null;
  if (q.currency && q.currency !== currency) {
    amount = Math.round((currency === "EUR" ? toEur(q.amount, q.currency, rate) : toTry(q.amount, q.currency, rate)) * 100) / 100;
    const orig = `Orijinal tutar: ${q.amount} ${q.currency}`;
    note = note ? `${note} · ${orig}` : orig;
  }

  let categoryId: string | null = null;
  let categoryName: string | null = null;
  {
    const [{ data: rules }, { data: cats }] = await Promise.all([
      db.from("category_rules").select("pattern,category_id").eq("user_id", uid),
      db.from("categories").select("*").eq("user_id", uid),
    ]);
    const m = (q.merchant ?? "").toLowerCase();
    categoryId = m ? rules?.find((r) => m.includes(r.pattern.toLowerCase()))?.category_id ?? null : null;
    if (!categoryId && q.categoryName) categoryId = cats?.find((c) => c.name_tr === q.categoryName)?.id ?? null;
    if (!categoryId && q.merchant && q.kind === "expense") {
      const name = suggestCategoryName(q.merchant);
      categoryId = categoryIdByKey(cats, name);
    }
    categoryName = cats?.find((c) => c.id === categoryId)?.name_tr ?? null;
  }

  const txnId = q.id ?? crypto.randomUUID();
  const row = {
      id: txnId,
      user_id: uid,
      account_id: account.id,
      category_id: categoryId,
      kind: q.kind,
      amount,
      currency,
      eur_try_rate: rate,
      occurred_on: q.occurredOn ?? todayISO(),
      merchant: q.merchant ?? null,
      note,
      receipt_path: q.receiptPath ?? null,
      source: q.source,
      external_id: q.externalId ?? null,
  };
  const items = (q.items ?? []).map((i) => ({ ...i, user_id: uid, merchant: i.merchant ?? q.merchant ?? null, purchased_on: i.purchased_on ?? q.occurredOn ?? todayISO() }));
  let newId: string;
  if (q.receiptFileKey) {
    const { data, error } = await db.rpc("insert_telegram_receipt", {
      p_txn: row, p_items: items, p_file_key: q.receiptFileKey, p_backfill: q.cashReceiptBackfill ?? false,
    });
    if (error) throw error;
    newId = data as string;
  } else {
    newId = await insertTxnWithItems(db, row, items);
  }
  return { id: newId, accountName: account.name, currency, amount, categorized: !!categoryId, categoryName };
}

// Apple Pay bildirimi geldiğinde, aynı alışveriş için Telegram fişi zaten (varsayılan nakit hesaba) girildiyse yeni işlem açmaz:
// fişin işlemini kartın hesabına taşır ve Apple Pay olarak işaretler. Eşleşme yoksa null döner.
export async function mergeIntoReceiptTxn(q: { amount: number; currency?: Currency; merchant?: string; accountHint?: string; date: string; externalId?: string }) {
  const db = adminClient();
  const uid = ownerId();
  const { findMatch } = await import("@/lib/merge");
  const match = await findMatch(db, uid, { amount: q.amount, currency: q.currency ?? null, merchant: q.merchant, date: q.date }, "telegram");
  if (!match) return null;
  const { data: accounts } = await db.from("accounts").select("*").eq("user_id", uid).eq("archived", false);
  if (!accounts?.length) return null;
  const card = pickAccount(accounts, q.accountHint, (q.currency ?? (match.currency as Currency)), false);
  if (card.currency !== match.currency) return null; // para birimi farklı: birleştirme
  const note = [match.note, "Apple Pay"].filter(Boolean).join(" · ");
  // Apple Pay olay kimliği işleme yazılır: aynı bildirim yeniden gelirse veritabanında tanınır (fişin tekilleştirmesi dosya yolundan çalışır).
  const { error } = await db.from("transactions").update({ account_id: card.id, source: "apple_pay", note, ...(q.externalId ? { external_id: q.externalId } : {}) }).eq("id", match.id);
  if (error) throw new Error(error.message);
  return { id: match.id, accountName: card.name, amount: Number(match.amount), currency: match.currency as Currency, merchant: match.merchant };
}

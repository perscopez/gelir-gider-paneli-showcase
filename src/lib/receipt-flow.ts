import { adminClient, ownerId } from "@/lib/supabase/admin";
import { recordQuickTxn } from "@/lib/ingest";
import { RECEIPT_MIMES, readReceipt } from "@/lib/receipt";
import { telegramDownload, telegramSend } from "@/lib/notify";
import { fmt } from "@/lib/money";
import { UserFacingError, userMessage } from "@/lib/errors";
import { addDaysISO, todayISO } from "@/lib/date";
import { pricePerBase } from "@/lib/grocery";
import { loadPriceIndex } from "@/lib/price-data";
import { judge, overpay } from "@/lib/price-verdict";
import { findMatch, merchantsOverlap, type MatchRow } from "@/lib/merge";
import { previewTelegramStatement } from "@/lib/statements/telegram";

export type TgFileMessage = {
  caption?: string;
  photo?: { file_id: string; file_unique_id: string; file_size?: number }[];
  document?: { file_id: string; file_unique_id: string; mime_type?: string; file_size?: number };
};

const MAX_BYTES = 6 * 1024 * 1024;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf" };

// Telegram'a atılan fiş fotoğrafı / PDF'i: okur, nakit hesaba gider olarak kaydeder, görseli fiş olarak ekler.
export async function handleReceipt(chat: number, msg: TgFileMessage) {
  const photo = msg.photo?.at(-1);
  const file = photo ? { id: photo.file_id, uid: photo.file_unique_id, mime: "image/jpeg", size: photo.file_size } : msg.document
    ? { id: msg.document.file_id, uid: msg.document.file_unique_id, mime: msg.document.mime_type ?? "", size: msg.document.file_size } : null;
  if (!file) return;
  if (!RECEIPT_MIMES.includes(file.mime)) return void (await telegramSend(chat, "Bu dosya türünü okuyamam. Fotoğraf (JPG/PNG) veya PDF gönder."));
  if (file.size && file.size > MAX_BYTES) return void (await telegramSend(chat, "Dosya 6 MB'dan büyük. Daha küçük bir fotoğraf gönder."));

  const db = adminClient();
  const uid = ownerId();
  // Hesap ipucu (@nakit/@kart) verildiyse "tgh:": sonradan gelen Apple Pay bu kaydı karta taşımasın.
  const caption0 = msg.caption?.trim() ?? "";
  // Telegram file_unique_id zaten [A-Za-z0-9_-]; yine de PostgREST .or() filtresine girmeden önce temizlenir (filtre enjeksiyonu olmasın).
  const fileKey = file.uid.replace(/[^A-Za-z0-9_-]/g, "");
  const externalId = `${/@\S+/.test(caption0) ? "tgh" : "tg"}:${fileKey}`;
  const altId = externalId.startsWith("tgh") ? `tg:${fileKey}` : `tgh:${fileKey}`;
  const { data: seen, error: seenError } = await db.from("transactions").select("id").eq("user_id", uid).or(`external_id.eq.${externalId},external_id.eq.${altId},receipt_path.like.*${fileKey}-tg.*`).limit(1);
  if (seenError) throw seenError;
  if (seen?.length) return void (await telegramSend(chat, "Bu fiş zaten kayıtlı."));

  try {
    const bytes = await telegramDownload(file.id);
    if (bytes.length > MAX_BYTES) throw new UserFacingError("Dosya 6 MB’dan büyük.");
    if (file.mime === "application/pdf" && await previewTelegramStatement(chat, bytes, /(?:^|\s)#ekstre(?:\s|$)/i.test(caption0))) return;
    await telegramSend(chat, "🧾 Fiş okunuyor…");
    const { data: cats } = await db.from("categories").select("name_tr").eq("user_id", uid).eq("kind", "expense");
    const r = await readReceipt({ bytes, mime: file.mime, categories: (cats ?? []).map((c) => c.name_tr) });

    // Başlıkta "@hesap" varsa o hesap, yoksa nakit hesap; kalan başlık metni nota yazılır.
    const caption = msg.caption?.trim() ?? "";
    const hint = caption.match(/@(\S+)/)?.[1];
    const noteText = caption.replace(/@\S+/g, "").trim();

    const today = todayISO();
    const inRange = r.date && r.date <= today && r.date >= addDaysISO(today, -400);
    const day = inRange ? r.date! : today;
    const delayed = !!inRange && day < today;
    const paymentAccount = async () => {
      if (!hint) return null;
      const { data, error } = await db.from("accounts").select("id,type,currency,name,match_keys,institution")
        .eq("user_id", uid).eq("archived", false).not("type", "in", "(blocked,reserve)");
      if (error) throw error;
      const key = hint.replace(/_/g, " ").toLocaleLowerCase("tr");
      const candidates = (data ?? []).filter((a) => (!r.currency || a.currency === r.currency) &&
        ([a.name, a.institution, ...(a.match_keys ?? "").split(/[,;\n]+/)].some((v) => v?.trim().toLocaleLowerCase("tr") === key)
          || (key === "nakit" && a.type === "cash")));
      if (candidates.length !== 1) throw new UserFacingError("Hesap seçilemedi. Başlıkta hesap adını boşluklar yerine alt çizgiyle yaz.");
      return candidates[0];
    };
    const account = await paymentAccount();
    let match: MatchRow | null = null;
    if (inRange) {
      let query = db.from("transactions")
        .select("id,merchant,amount,currency,occurred_on,account_id,category_id,note,receipt_path")
        .eq("user_id", uid).eq("kind", "expense").eq("occurred_on", day).eq("amount", r.total);
      if (r.currency) query = query.eq("currency", r.currency);
      if (account) query = query.eq("account_id", account.id);
      const { data, error } = await query;
      if (error) throw error;
      const candidates = (data ?? []).filter((t) => merchantsOverlap(t.merchant, r.merchant));
      if (candidates.length > 1) throw new UserFacingError("Birden fazla işlem eşleşiyor. Fişi panelden doğru işleme bağla.");
      if (candidates[0]?.receipt_path) return void await telegramSend(chat, "Bu alışverişin fişi zaten kayıtlı.");
      match = candidates[0] ?? null;
    }
    if (!match && !hint && inRange) {
      match = await findMatch(db, uid, { amount: r.total, currency: r.currency, merchant: r.merchant, date: day }, "apple_pay");
    }
    if (!match && !inRange) throw new UserFacingError("Fiş tarihi okunamadı. Daha net fotoğraf gönder veya işlemi panelden gir.");
    if (!match && delayed && !account) throw new UserFacingError(`${day} · ${r.merchant}. Bu eski fiş için ödeme hesabını başlıkta belirtip yeniden gönder. Örneğin @nakit veya @Fabrikam_Banka.`);
    const cashBackfill = delayed && account?.type === "cash";
    const id = crypto.randomUUID();
    // Yol adı: zaman damgası (/sil sırası için) + dosya kimliği (aynı fotoğrafı iki kez işlememek için)
    const path = `${uid}/${Date.now()}_${fileKey}-tg.${EXT[file.mime]}`;
    const up = await db.storage.from("receipts").upload(path, bytes, { contentType: file.mime });
    if (up.error) throw new Error(`Fiş dosyası kaydedilemedi: ${up.error.message}`); // ayrıntı yalnızca loga gider

    // Aynı alışveriş Apple Pay ile zaten kayıtlıysa yeni işlem açma: fişi o işleme bağla.
    const noteJoined = [noteText, r.summary].filter(Boolean).join(" · ") || null;
    // Fiş kalemleri: işlemle birlikte TEK veritabanı işleminde yazılır (yarım kayıt kalmaz).
    const itemRows = r.isGrocery ? r.items.map((i, n) => {
      const p = pricePerBase(i);
      return {
        line_no: n + 1, name: i.name, product: i.product, brand: i.brand, quantity: i.quantity, unit: i.unit, pack_amount: i.packAmount, pack_unit: i.packUnit,
        unit_price: i.unitPrice, line_total: i.lineTotal, category: i.category, base_unit: p.baseUnit, price_per_base: p.pricePerBase,
        merchant: r.merchant, purchased_on: day, currency: r.currency ?? null,
      };
    }) : [];
    let tx: { id: string; amount: number; currency: "EUR" | "TRY"; accountName: string; categoryName: string | null };
    let merged = false;
    if (match) {
      merged = true;
      const { data: cats2 } = await db.from("categories").select("id,name_tr").eq("user_id", uid);
      const catId = match.category_id ?? cats2?.find((c) => c.name_tr === r.category)?.id ?? null;
      try {
        const { error } = await db.rpc("attach_telegram_receipt", {
          p_user: uid, p_id: match.id, p_patch: { receipt_path: path, category_id: catId, note: [match.note, noteJoined].filter(Boolean).join(" · ") || null },
          p_items: itemRows, p_file_key: fileKey,
        });
        if (error) throw error;
      } catch (e) { await db.storage.from("receipts").remove([path]); throw e; }
      const { data: acc } = await db.from("accounts").select("name").eq("id", match.account_id).maybeSingle();
      tx = { id: match.id, amount: Number(match.amount), currency: match.currency as "EUR" | "TRY", accountName: acc?.name ?? "?", categoryName: cats2?.find((c) => c.id === catId)?.name_tr ?? null };
    } else {
      try {
        tx = await recordQuickTxn({
          kind: "expense", amount: r.total, currency: r.currency ?? undefined, merchant: r.merchant, accountHint: hint, accountId: account?.id, cashReceiptBackfill: cashBackfill, receiptFileKey: fileKey,
          preferCash: !hint, categoryName: r.category ?? undefined, source: "telegram", externalId, id, receiptPath: path,
          occurredOn: day, note: noteJoined ?? undefined, items: itemRows,
        });
      } catch (e) {
        await db.storage.from("receipts").remove([path]);
        throw e;
      }
    }
    let itemsNote = "";
    if (r.isGrocery) {
      const byCat = new Map<string, number>();
      for (const i of r.items) byCat.set(i.category, (byCat.get(i.category) ?? 0) + 1);
      const top = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, n]) => `${c} ${n}`).join(" · ");
      const diff = r.itemsDiff !== null && Math.abs(r.itemsDiff) > 0.05 ? `\n⚠ Kalemlerin toplamı fiş toplamından ${fmt(Math.abs(r.itemsDiff), tx.currency, "tr")} ${r.itemsDiff > 0 ? "az" : "fazla"}, bazı satırlar eksik/fazla okunmuş olabilir.` : "";
      const lines = r.items.slice(0, 30).map((i) => {
        const qty = i.quantity !== 1 ? ` ×${i.quantity}${i.unit && i.unit !== "pcs" ? i.unit : ""}` : "";
        return `• ${(i.product ?? i.name).slice(0, 32)}${qty} — ${fmt(i.lineTotal, tx.currency, "tr")}`;
      });
      const more = r.items.length > 30 ? `\n… +${r.items.length - 30} kalem daha (panelde)` : "";
      itemsNote = `\n🛒 ${r.items.length} kalem: ${top}${diff}\n${lines.join("\n")}${more}`;
    }
    if (r.isGrocery) {
      // Fiyat kontrolü: kalemler kendi geçmiş fiyat medyanına göre değerlendirilir (bu fişin kalemleri ortalamaya girmez). Hata olursa fiş yanıtı yine gider.
      try {
        const idx = await loadPriceIndex(db, 365, uid);
        const judged = r.items.map((i) => { const p = pricePerBase(i); return { i, p, v: judge(p.pricePerBase, i.product, p.baseUnit, idx, tx.id) }; })
          .filter((x) => x.v.level !== "new" && x.i.lineTotal > 0 && x.p.pricePerBase);
        if (judged.length) {
          const pricey = judged.filter((x) => x.v.level === "expensive")
            .map((x) => ({ ...x, extra: overpay(x.i.lineTotal, x.p.pricePerBase!, x.v) })).sort((a, b) => b.extra - a.extra);
          const cheapN = judged.filter((x) => x.v.level === "cheap").length;
          const extra = pricey.reduce((a, x) => a + x.extra, 0);
          const lines = pricey.slice(0, 4).map((x) => `🔴 ${(x.i.product ?? x.i.name).slice(0, 28)}: ${fmt(x.p.pricePerBase!, tx.currency, "tr")}/${x.p.baseUnit === "pcs" ? "adet" : x.p.baseUnit} (ort. ${fmt(x.v.median!, tx.currency, "tr")}, +${Math.round((x.v.pct ?? 0) * 100)}%)`);
          itemsNote += `\n💶 Fiyat kontrolü: ${pricey.length} pahalı · ${cheapN} ucuz · ${judged.length - pricey.length - cheapN} normal${extra > 0.05 ? ` · tahmini fazla ödeme ${fmt(extra, tx.currency, "tr")}` : ""}${lines.length ? "\n" + lines.join("\n") : ""}`;
        }
      } catch { /* fiyat kontrolü isteğe bağlı */ }
    }
    if (!r.isGrocery) itemsNote = "\nℹ Kalem satırı okunamadı (tek tutar kaydedildi). Fotoğraf net ve fişin tamamı görünür olmalı; yine olmazsa fişi tekrar gönder.";
    await telegramSend(chat, `${merged ? "🔗 Mevcut işleme fiş bağlandı\n" : ""}✓ ${r.merchant}: ${fmt(tx.amount, tx.currency, "tr")} → ${tx.accountName}${tx.categoryName ? ` · ${tx.categoryName}` : " · kategorisiz"} · ${day}${itemsNote}\n(${r.provider === "groq" ? "Groq" : "Gemini"} okudu) · ${merged ? "Yanlış birleştiyse /sil: fiş ayrılır." : "Yanlışsa /sil yaz."}`);
  } catch (e) {
    if (/Receipt already (recorded|attached)/i.test(String((e as { message?: string })?.message ?? ""))) {
      await telegramSend(chat, "Bu fiş zaten kayıtlı veya ilgili işlemde başka bir fiş var.");
    } else await telegramSend(chat, userMessage(e, "telegram-receipt"));
  }
}

// Telegram'dan gelen en son fişi geri alır: kendi açtığı işlemse siler, Apple Pay işlemine bağlanmışsa yalnızca fişi/kalemleri ayırır.
// Sıra: önce veritabanı (hata kontrolüyle), başarılıysa sonra görsel. DB hata verirse görsele dokunulmaz, "silindi" denmez.
export async function deleteLastTelegram(chat: number) {
  const db = adminClient();
  const uid = ownerId();
  const { data: rows } = await db.from("transactions").select("id,merchant,amount,currency,receipt_path,source,external_id,created_at,note").eq("user_id", uid)
    .or("source.eq.telegram,receipt_path.like.*-tg.*").order("created_at", { ascending: false }).limit(30);
  // Sıralama: yol adındaki zaman damgası (birleşen fişler için de geçerli), yoksa oluşturulma zamanı.
  const stamp = (r: { receipt_path: string | null; created_at: string }) => Number(r.receipt_path?.match(/\/(\d{13})_/)?.[1] ?? new Date(r.created_at).getTime());
  const t = (rows ?? []).sort((a, b) => stamp(b) - stamp(a))[0];
  if (!t) return void (await telegramSend(chat, "Silinecek Telegram kaydı yok."));
  const label = `${t.merchant ?? "?"} ${fmt(Number(t.amount), t.currency as "EUR" | "TRY", "tr")}`;
  const fail = async (what: string, err: { message: string }) => {
    console.error(`[telegram-sil] ${what}:`, err.message);
    await telegramSend(chat, `⚠ ${label} silinemedi, kayıt olduğu gibi duruyor. Biraz sonra tekrar dene.`);
  };

  const ownsTransaction = t.source === "telegram" && (!t.receipt_path || /^tgh?:/.test(t.external_id ?? ""));
  if (ownsTransaction) {
    const { error } = await db.from("transactions").delete().eq("id", t.id);
    if (error) return void (await fail("işlem silinemedi", error));
  } else {
    const upd = await db.from("transactions").update({ receipt_path: null }).eq("id", t.id);
    if (upd.error) return void (await fail("fiş ayrılamadı", upd.error));
    const del = await db.from("receipt_items").delete().eq("transaction_id", t.id);
    if (del.error) console.error("[telegram-sil] kalemler silinemedi:", del.error.message); // işlem ayrıldı; kalemler artık sahipsiz kalabilir ama zararsız
  }
  if (t.receipt_path) {
    const rm = await db.storage.from("receipts").remove([t.receipt_path]);
    if (rm.error) console.error("[telegram-sil] görsel silinemedi:", rm.error.message); // kayıt gitti; yetim dosya yalnızca yer kaplar
  }
  await telegramSend(chat, ownsTransaction ? `🗑 Silindi: ${label}` : `↩ Fiş ayrıldı, ${label} işlemi duruyor.`);
}

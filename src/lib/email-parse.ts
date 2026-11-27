import type { Currency } from "@/lib/money";

// Banka bildirim e-postalarını okur. Yeni banka eklemek için PARSERS'a bir kayıt eklemek yeter.
export type ParsedEmail = {
  type: "txn";
  bank: string; // hesap adı/kurum ipucu
  kind: "income" | "expense";
  amount: number;
  currency: Currency;
  merchant: string;
  occurredOn: string; // YYYY-MM-DD
  balanceAfter?: number;
  externalId: string;
  accountLast4?: string;
};

// İşlem olmayan ama bilmen gereken e-postalar (kredi kartı son ödeme/ekstre): hesaba yazılmaz, bildirim olarak gönderilir.
export type ParsedReminder = { type: "reminder"; title: string; text: string };
export type ParsedMail = ParsedEmail | ParsedReminder;

export type RawEmail = { from: string; subject: string; body: string; messageId?: string };

// "7.481,16 TL" / "5.000 TL" / "1.234,5 TL" → 7481.16
export function trNumber(s: string): number | null {
  const m = s.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?)/);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// "Etiket : değer" ya da (iki sütunlu tabloda) "Etiket  değer"
const field = (text: string, label: string) => text.match(new RegExp(`${label}[ \\t]*:?[ \\t]*([^\\n]+)`, "i"))?.[1]?.replace(/^:\s*/, "").trim();
const isoFromTr = (s?: string) => {
  const m = s?.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

// HTML gövdeyi satırlı düz metne çevirir ("Etiket : değer" satırları korunur).
export function htmlToText(html: string): string {
  return html
    .replace(/[\u00a0\u2007\u202f]/g, " ") // Apps Script gövdesi kırılmaz boşluk içerir; normal boşluğa çevrilmezse etiket/değer eşleşmez
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(tr|p|div|br)>|<br\s*\/?>/gi, "\n")
    .replace(/<\/td>\s*<td[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'")
    .replace(/[ \t\r]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n").trim();
}

// Parser'ın döndürdüğü banka anahtarı -> hesap adı/kurum. Yeni banka parser'ı eklerken buraya da yaz (yanlış ad/hesap oluşmasın).
export const BANK_NAMES: Record<string, string> = { "anka": "Anka Bank" };
export const bankName = (key: string) => BANK_NAMES[key] ?? key.charAt(0).toUpperCase() + key.slice(1);

const PARSERS: ((e: RawEmail, text: string) => ParsedMail | null)[] = [
  // Anka Bank: "Hesabınıza FAST Anlık Ödeme / EFT / Havale gelmiştir."
  (e, text) => {
    if (!/ankabank\.example/i.test(e.from) && !/anka ?bank/i.test(e.subject)) return null;
    if (!/gelmi[şs]tir/i.test(text)) return null;
    const amount = trNumber(field(text, "İşlem Tutarı") ?? field(text, "Islem Tutari") ?? "");
    if (!amount) return null;
    const sender = field(text, "Gönderen Adı Soyadı") ?? field(text, "Gönderen") ?? "";
    const bank = field(text, "Gönderen Banka");
    const query = field(text, "Sorgu Numarası") ?? "";
    const when = field(text, "İşlem Tarihi");
    const kindLabel = text.match(/(FAST[^\n.]*|EFT|Havale)[^\n]*gelmi/i)?.[1]?.trim() ?? "Gelen transfer";
    return {
      type: "txn",
      bank: "anka",
      kind: "income",
      amount,
      currency: "TRY",
      merchant: [kindLabel, sender, bank].filter(Boolean).join(" · ").slice(0, 120),
      occurredOn: isoFromTr(when) ?? new Date().toISOString().slice(0, 10),
      balanceAfter: trNumber(field(text, "Güncel Bakiye") ?? "") ?? undefined,
      accountLast4: field(text, "Hesap Numarası")?.match(/(\d{4})\s*$/)?.[1],
      externalId: `mail:anka:${query || e.messageId || `${when}:${amount}`}`,
    };
  },
  // Anka Bank: giden FAST/EFT/havale ("Bankamızdan gönderdiğiniz FAST Anlık Ödeme işleminiz başarı ile gerçekleştirilmiştir.")
  (e, text) => {
    if (!/ankabank\.example/i.test(e.from) && !/anka ?bank/i.test(e.subject)) return null;
    if (!/g[öo]nderdi[ğg]iniz[\s\S]{0,80}ger[çc]ekle[şs]tirilmi[şs]tir/i.test(text)) return null;
    const amount = trNumber(field(text, "İşlem Tutarı") ?? "");
    if (!amount) return null;
    const receiver = field(text, "Alıcı Adı Soyadı") ?? "";
    const bank = field(text, "Alıcı Banka");
    const query = field(text, "Sorgu Numarası") ?? "";
    const when = field(text, "İşlem Tarihi");
    const kindLabel = text.match(/(FAST[^\n.]*?|EFT|Havale)\s+i[şs]leminiz/i)?.[1]?.trim() ?? "Giden transfer";
    return {
      type: "txn", bank: "anka", kind: "expense", amount, currency: "TRY",
      merchant: [kindLabel, receiver, bank].filter(Boolean).join(" · ").slice(0, 120),
      occurredOn: isoFromTr(when) ?? new Date().toISOString().slice(0, 10),
      balanceAfter: trNumber(field(text, "Güncel Bakiye") ?? "") ?? undefined,
      accountLast4: field(text, "Hesap Numarası")?.match(/(\d{4})\s*$/)?.[1],
      externalId: `mail:anka:${query || e.messageId || `${when}:${amount}`}`,
    };
  },
  // Anka Bank: debit kartıyla alışveriş ("Mevduat Hesabı Para Çıkışları"). Sorgu numarası yok: e-posta kimliği tekilleştirir.
  (e, text) => {
    if (!/ankabank\.example/i.test(e.from) && !/anka ?bank/i.test(e.subject)) return null;
    if (!/debit kart[ıi]n[ıi]z ile ger[çc]ekle[şs]en al[ıi][şs]veri[şs]/i.test(text)) return null;
    const amount = trNumber(field(text, "İşlem Tutarı") ?? "");
    const shop = field(text, "İşyeri Adı")?.replace(/\s+/g, " ").replace(/\s+(TRTR|TR|DEU|DE|USA|US)$/i, "").trim();
    if (!amount || !shop) return null;
    const when = field(text, "İşlem Tarihi");
    return {
      type: "txn", bank: "anka", kind: "expense", amount, currency: "TRY", merchant: shop.slice(0, 120),
      occurredOn: isoFromTr(when) ?? new Date().toISOString().slice(0, 10),
      accountLast4: field(text, "Hesap Numarası")?.match(/(\d{4})\s*$/)?.[1],
      externalId: `mail:anka:card:${e.messageId || `${when}:${amount}:${shop}`}`,
    };
  },
  // Anka Bank kredi kartı hesap özeti e-postası (özet gövdede, ayrıntı ekli PDF'te)
  (e, text) => {
    if (!/statements@ankabank\.example/i.test(e.from) && !/kredi kart[ıi] hesap [öo]zet/i.test(e.subject)) return null;
    const grab = (label: string) => text.match(new RegExp(`${label}[ \\t]*:?[ \\t]*([\\d.,]+)`, "i"))?.[1];
    const debt = grab("Toplam Borç Bakiyesi");
    const min = grab("Asgari Ödeme Tutar[ıi]");
    const due = text.match(/Son Ödeme Tarihi[ \t]*:?[ \t]*(\d{2}\.\d{2}\.\d{4})/i)?.[1];
    if (!debt) return null;
    const usNum = (s?: string) => { const n = Number((s ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n.toLocaleString("tr-TR", { minimumFractionDigits: 2 }) : "?"; }; // ekstre e-postası 1,234.56 biçiminde yazar
    return { type: "reminder", title: "💳 Kredi kartı ekstresi kesildi", text: `💳 Kredi kartı ekstresi kesildi\nDönem borcu: ${usNum(debt)} TL · Asgari: ${usNum(min)} TL · Son ödeme: ${due ?? "?"}` };
  },
  // Anka Bank kredi kartı: son ödeme / asgari ödenmedi hatırlatması
  (e, text) => {
    if (!/ankabank\.example/i.test(e.from) && !/anka ?bank/i.test(e.subject)) return null;
    if (!/kredi kart[ıi]/i.test(text) || !/(son [öo]deme tarihi|asgari)/i.test(e.subject + " " + text)) return null;
    const debt = trNumber(field(text, "Ekstre Borç Bakiyesi") ?? "");
    const min = trNumber(field(text, "Asgari Ödeme Tut[ae]r[ıi]") ?? "");
    const due = text.match(/Son Ödeme Tarihi[ \t]*:?[ \t]*(\d{2}\.\d{2}\.\d{4})/i)?.[1]; // giriş cümlesindeki "son ödeme tarihi bugündür" ile karışmasın
    if (debt === null && min === null) return null;
    const tr = (n: number | null) => (n === null ? "?" : n.toLocaleString("tr-TR", { minimumFractionDigits: 2 }));
    const unpaid = /asgarisi [öo]denmemi[şs]tir/i.test(text);
    const today = /son [öo]deme tarihi bug[üu]nd[üu]r/i.test(text);
    const head = unpaid ? "⚠ Kredi kartı asgari ödemesi yapılmamış" : today ? "⏰ Kredi kartı son ödeme günü bugün" : "💳 Kredi kartı hatırlatması";
    return { type: "reminder", title: head, text: `${head}\nEkstre borcu: ${tr(debt)} TL · Asgari: ${tr(min)} TL · Son ödeme: ${due ?? "?"}` };
  },
];

export function parseBankEmail(e: RawEmail): ParsedMail | null {
  const text = /<(html|table|body|td)\b/i.test(e.body) ? htmlToText(e.body) : e.body.replace(/[\u00a0\u2007\u202f]/g, " ");
  for (const p of PARSERS) {
    const r = p(e, text);
    if (r) return r;
  }
  return null;
}

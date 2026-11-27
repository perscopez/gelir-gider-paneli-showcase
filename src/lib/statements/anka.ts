import type { ParsedStatement, StatementKind, StatementRow } from "./contoso";

// Anka Bank PDF ekstreleri: kredi kartı hesap özeti ve debit (banka kartı) alışveriş özeti.
// Girdi: PDF sayfalarının metni (unpdf extractText, mergePages:false). Contoso Bank ayrıştırıcısı gibi toplamlar doğrulanır; tutmazsa hata verir.

const DATE = /^\d{2}\.\d{2}\.\d{4}$/;
const iso = (d: string) => `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}`;
const us = (s: string) => Number(s.replace(/,/g, ""));         // 1,234.56
const tr = (s: string) => Number(s.replace(/\./g, "").replace(",", ".")); // 1.234,56
const r2 = (n: number) => Math.round(n * 100) / 100;
const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const lines = (pages: string[]) => pages.flatMap((p) => p.split(/\r?\n/)).map((l) => l.trim()).filter(Boolean);
const val = (all: string[], label: RegExp) => all.map((l) => l.match(label)?.[1]).find(Boolean);

export type StatementType = "anka-card" | "anka-debit" | "contoso" | "lale-card" | "anka-account";
export function detectStatement(pages: string[]): StatementType | null {
  const t = pages.join("\n");
  if (/Kredi Kartı Hesap Özeti/i.test(t) && /HESAP BİLGİLERİNİZ/i.test(t)) return "anka-card";
  if (/DEBIT PARA\s*\n?\s*EKSTRES/i.test(t) || (/Debit Para Bilgileriniz/i.test(t) && /Toplam Alışveriş Tutarı/i.test(t))) return "anka-debit";
  if (/Hesap Hareketleri/i.test(t) && /İŞLEM ADI/.test(t) && /Hesap Türü/i.test(t)) return "anka-account";
  if (/Kredi Kartı Hesap Ekstresi/i.test(t) && /Kredi Kartı Numarası/i.test(t) && /Kalan Taksit/i.test(t)) return "lale-card";
  if (/Contoso Bank/.test(t) && /Transaction date/.test(t)) return "contoso";
  return null;
}

export type CardInfo = { last4: string | null; limit: number | null; cutoff: string | null; dueDate: string | null; minPayment: number | null; debt: number };
export type ParsedCardStatement = ParsedStatement & { card: CardInfo };

export function parseAnkaCard(pages: string[]): ParsedCardStatement {
  const all = lines(pages);
  const warnings: string[] = [];
  const debt = us(val(all, /^Dönem Borcunuz\s*:\s*([\d,]+\.\d{2})/) ?? "NaN");
  const minPayment = val(all, /^Asgari Ödeme Tutarı\s*:\s*([\d,]+\.\d{2})/);
  const dueDate = val(all, /^Son Ödeme Tarihi\s*:\s*(\d{2}\.\d{2}\.\d{4})/);
  const cutoff = val(all, /^Hesap Kesim Tarihi\s*:\s*(\d{2}\.\d{2}\.\d{4})/);
  const limit = val(all, /^Limitiniz\s*:\s*([\d,]+\.\d{2})/);
  const last4 = val(all, /^Kart No\s*:\s*[\d*]*?(\d{4})\s*$/) ?? null;
  const prevBalance = us(val(all, /^Önceki Hesap Bakiyesi\s+([\d,]+\.\d{2})/) ?? "NaN");
  const periodPurchases = us(val(all, /^Dönem Içi Islemler\s+([\d,]+\.\d{2})/) ?? "NaN");
  const fees = us(val(all, /^Toplam Faiz ve Ücretler\s+([\d,]+\.\d{2})/) ?? "0");
  const payments = us(val(all, /^Ödemeler\s+\+?([\d,]+\.\d{2})/) ?? "0");
  if (!Number.isFinite(debt) || !Number.isFinite(prevBalance) || !Number.isFinite(periodPurchases)) throw new Error("Kredi kartı ekstresinde dönem borcu/özet bulunamadı.");

  const start = all.findIndex((l) => /^İŞLEM TARİHİ\s+AÇIKLAMA/.test(l));
  const end = all.findIndex((l, i) => i > start && /^HESAP ÖZETİ$/.test(l));
  if (start < 0 || end < 0) throw new Error("Kredi kartı işlem tablosu bulunamadı.");

  const rows: StatementRow[] = [];
  const seen = new Map<string, number>();
  for (const l of all.slice(start + 1, end)) {
    const m = l.match(/^(\d{2}\.\d{2}\.\d{4}) (.+?) ([+-]?[\d,]+\.\d{2})(?: \d+(?:\.\d+)?)*$/);
    if (!m || !DATE.test(m[1])) { if (DATE.test(l.slice(0, 10))) warnings.push(`Satır okunamadı: ${l}`); continue; }
    let desc = m[2].trim();
    const signed = us(m[3]);
    if (/ÖNCEKİ DÖNEM HESAP ÖZETİ BAKİYENİZ/i.test(desc)) continue; // devir satırı, işlem değil
    const fx = desc.match(/^(\d+(?:\.\d+)?) ([A-Z]{3}) (.+)$/); // "10.00 EUR DEMO CLOUD..." = dövizli harcama
    let note: string | null = null;
    if (fx) { note = `Orijinal tutar: ${fx[1]} ${fx[2]}`; desc = fx[3]; }
    const isPayment = /ÖDEMENİZ İÇİN TEŞEKKÜRLER/i.test(desc) || (signed > 0 && /ÖDEME/i.test(desc));
    const kind: StatementKind = isPayment ? "card_payment" : "card";
    const amount = isPayment || m[3].startsWith("+") ? Math.abs(signed) : -Math.abs(signed); // kart hesabına bakış: harcama −, ödeme/iade +
    const date = iso(m[1]);
    const key = `${date}|${amount}|${desc}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    rows.push({
      date, amount: r2(amount), balanceAfter: 0, merchant: (isPayment ? "Kredi kartı ödemesi" : desc).slice(0, 120), note, kind, opType: isPayment ? "Kart ödemesi" : "Kart harcaması",
      cardLast4: last4, counterparty: null, externalId: `vk:${last4 ?? "card"}:${date}:${amount.toFixed(2)}:${hash(desc)}${n > 1 ? `:${n}` : ""}`,
    });
  }

  // Doğrulama: harcamalar, ödemeler ve borç zinciri ekstredeki rakamlarla tutmalı.
  const errors: string[] = [];
  const spent = r2(rows.filter((r) => r.kind === "card" && r.amount < 0).reduce((a, r) => a - r.amount, 0));
  const paid = r2(rows.filter((r) => r.kind === "card_payment").reduce((a, r) => a + r.amount, 0));
  const refunds = r2(rows.filter((r) => r.kind === "card" && r.amount > 0).reduce((a, r) => a + r.amount, 0));
  if (Math.abs(spent - r2(periodPurchases)) > 0.005 && Math.abs(r2(spent - refunds) - r2(periodPurchases)) > 0.005) errors.push(`Dönem içi işlemler tutmuyor (ekstre ${periodPurchases}, okunan ${spent}).`);
  if (Math.abs(paid - payments) > 0.005) errors.push(`Ödemeler tutmuyor (ekstre ${payments}, okunan ${paid}).`);
  if (Math.abs(r2(prevBalance + periodPurchases + fees - payments) - r2(debt)) > 0.005) errors.push("Borç zinciri tutmuyor (önceki bakiye + işlemler + faiz − ödemeler ≠ dönem borcu).");
  if (errors.length) throw new Error(`Ekstre doğrulanamadı: ${errors.join(" ")}`);

  return {
    bank: "anka-card", currency: "TRY", ibanLast4: last4, periodFrom: rows[0]?.date ?? null, periodTo: cutoff ? iso(cutoff) : rows.at(-1)?.date ?? null,
    startingBalance: -prevBalance, finalBalance: -debt, sumDebit: spent, sumCredit: paid, declaredCount: rows.length, rows, warnings,
    card: { last4, limit: limit ? us(limit) : null, cutoff: cutoff ? iso(cutoff) : null, dueDate: dueDate ? iso(dueDate) : null, minPayment: minPayment ? us(minPayment) : null, debt },
  };
}

// Debit (banka kartı) alışveriş özeti: vadesiz hesaptan yapılan kart harcamaları (ayda bir). Bakiye vermez; yalnızca toplam doğrulanır.
export function parseAnkaDebit(pages: string[]): ParsedStatement {
  const all = lines(pages);
  const warnings: string[] = [];
  const total = tr(val(all, /^Toplam Alışveriş Tutarı\s*:\s*([\d.]+,\d{2})/) ?? "NaN");
  const iban = val(all, /^Hesap No\s*:\s*[\d*]*?(\d{4})\s*$/) ?? null;
  if (!Number.isFinite(total)) throw new Error("Debit ekstresinde toplam alışveriş tutarı bulunamadı.");
  const start = all.findIndex((l) => /^İşlem Tarihi\s+Açıklama\s+Tutar/.test(l));
  const end = all.findIndex((l, i) => i > start && /^Debit Para Bilgileriniz/i.test(l));
  if (start < 0) throw new Error("Debit işlem tablosu bulunamadı.");

  const rows: StatementRow[] = [];
  const seen = new Map<string, number>();
  for (const l of all.slice(start + 1, end < 0 ? undefined : end)) {
    const m = l.match(/^(\d{2}\.\d{2}\.\d{4}) (.+?) ([\d.]+,\d{2}) ([\d.]+,\d{2})$/);
    if (!m) { if (DATE.test(l.slice(0, 10))) warnings.push(`Satır okunamadı: ${l}`); continue; }
    const date = iso(m[1]);
    const amount = -tr(m[3]);
    const desc = m[2].trim();
    const key = `${date}|${amount}|${desc}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    rows.push({
      date, amount: r2(amount), balanceAfter: 0, merchant: desc.slice(0, 120), note: `Debit Para: ${m[4]} TL`, kind: "card", opType: "Debit harcaması",
      cardLast4: null, counterparty: null, externalId: `vb:${iban ?? "acc"}:${date}:${amount.toFixed(2)}:${hash(desc)}${n > 1 ? `:${n}` : ""}`,
    });
  }
  const sum = r2(rows.reduce((a, r) => a - r.amount, 0));
  if (Math.abs(sum - r2(total)) > 0.005) throw new Error(`Ekstre doğrulanamadı: toplam alışveriş tutmuyor (ekstre ${total}, okunan ${sum}).`);
  return {
    bank: "anka-debit", balanceKnown: false, currency: "TRY", ibanLast4: iban, periodFrom: rows[0]?.date ?? null, periodTo: rows.at(-1)?.date ?? null,
    startingBalance: 0, finalBalance: 0, sumDebit: sum, sumCredit: 0, declaredCount: rows.length, rows, warnings,
  };
}

import type { ParsedStatement, StatementKind, StatementRow } from "./contoso";

// Lale Bank kredi kartı "Hesap Ekstresi" (dönem içi hareketler) PDF'i. Sütunlar: işlem tarihi, açıklama, tutar, kalan taksit (0-0), puan.
// Bu belge toplam/borç özeti içermez; bu yüzden toplamla doğrulama yapılamaz, yalnızca satır biçimi doğrulanır (okunamayan satır varsa hata).
const iso = (d: string) => `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}`;
const r2 = (n: number) => Math.round(n * 100) / 100;
const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

export function parseLaleCard(pages: string[]): ParsedStatement {
  const all = pages.flatMap((p) => p.split(/\r?\n/)).map((l) => l.trim()).filter(Boolean);
  const last4 = all.map((l) => l.match(/^Kredi Kartı Numarası\s+[\d*]*?(\d{4})\s*$/)?.[1]).find(Boolean) ?? null;
  const rows: StatementRow[] = [];
  const bad: string[] = [];
  const seen = new Map<string, number>();
  for (const l of all) {
    if (!/^\d{2}\/\d{2}\/\d{4}\s/.test(l)) continue;
    const m = l.match(/^(\d{2}\/\d{2}\/\d{4}) (.+?) (-?\d+(?:[.,]\d{1,2})?) (\d+)-(\d+) -?\d+(?:[.,]\d+)?$/);
    if (!m) { bad.push(l); continue; }
    const desc = m[2].trim();
    const signed = Number(m[3].replace(",", "."));
    const isPayment = /ÖDEME|TAHSİLAT|TAHSILAT/i.test(desc) && signed < 0;
    const kind: StatementKind = isPayment ? "card_payment" : "card";
    const amount = signed < 0 ? Math.abs(signed) : -signed; // kart hesabına bakış: harcama −, ödeme/iade +
    const date = iso(m[1]);
    const key = `${date}|${amount}|${desc}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    const inst = Number(m[5]) > 0 ? `Taksit: ${m[4]}/${m[5]}` : null;
    rows.push({
      date, amount: r2(amount), balanceAfter: 0, merchant: (isPayment ? "Kredi kartı ödemesi" : desc).slice(0, 120), note: inst, kind, opType: isPayment ? "Kart ödemesi" : "Kart harcaması",
      cardLast4: last4, counterparty: null, externalId: `qk:${last4 ?? "card"}:${date}:${amount.toFixed(2)}:${hash(desc)}${n > 1 ? `:${n}` : ""}`,
    });
  }
  if (bad.length) throw new Error(`Lale Bank ekstresinde okunamayan satır var: ${bad.slice(0, 3).join(" | ")}`);
  if (!rows.length) throw new Error("Lale Bank ekstresinde işlem satırı bulunamadı.");
  const spent = r2(rows.filter((r) => r.amount < 0).reduce((a, r) => a - r.amount, 0));
  const paid = r2(rows.filter((r) => r.amount > 0).reduce((a, r) => a + r.amount, 0));
  return {
    bank: "lale-card", balanceKnown: false, currency: "TRY", ibanLast4: last4, periodFrom: rows[0].date, periodTo: rows.at(-1)!.date,
    startingBalance: 0, finalBalance: 0, sumDebit: spent, sumCredit: paid, declaredCount: rows.length, rows,
    warnings: ["Bu belge toplam içermiyor; tutarlar toplamla doğrulanamadı. Satır sayısını ve toplamı kendi ekstrenle karşılaştır."],
  };
}

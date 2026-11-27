import type { ParsedStatement, StatementRow } from "./contoso";

// Anka Bank vadesiz hesap "Hesap Hareketleri" PDF'i (e-ekstre). Her satırda işlem no ve satır satır bakiye vardır: bakiye zinciri doğrulanır.
const iso = (d: string) => `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}`;
const tr = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
const r2 = (n: number) => Math.round(n * 100) / 100;
const ROW = /^(\d{2}\.\d{2}\.\d{4}) \d{2}:\d{2} (\d{10,20}) (-?[\d.]+,\d{2}) (-?[\d.]+,\d{2}) (.+)$/;

export function parseAnkaAccount(pages: string[]): ParsedStatement {
  const all = pages.flatMap((p) => p.split(/\r?\n/)).map((l) => l.trim()).filter(Boolean);
  const headBalance = all.map((l) => l.match(/Bakiye\s*:\s*(-?[\d.]+,\d{2}) TL/)?.[1]).find(Boolean);
  const accNo = all.map((l) => l.match(/^Hesap No\s*:\s*[\d*]*?(\d{4})\s*$/)?.[1]).find(Boolean) ?? null;
  const range = all.map((l) => l.match(/Tarih Aralığı\s*:\s*(\d{2}\.\d{2}\.\d{4}) - (\d{2}\.\d{2}\.\d{4})/)).find(Boolean);
  if (!headBalance) throw new Error("Hesap hareketleri ekstresinde bakiye bulunamadı.");
  const start = all.findIndex((l) => /^TARİH SAAT İŞLEM NO/.test(l));
  if (start < 0) throw new Error("Hesap hareketleri tablosu bulunamadı.");

  type Raw = { date: string; no: string; amount: number; balance: number; name: string; desc: string[] };
  const raw: Raw[] = [];
  for (const l of all.slice(start + 1)) {
    const m = l.match(ROW);
    if (m) raw.push({ date: iso(m[1]), no: m[2], amount: tr(m[3]), balance: tr(m[4]), name: m[5].trim(), desc: [] });
    else if (raw.length && !/^\*\*\*|^www\.|^Sf\./.test(l)) raw.at(-1)!.desc.push(l);
  }
  if (!raw.length) throw new Error("Hesap hareketleri ekstresinde işlem satırı bulunamadı.");

  // Doğrulama: bakiye zinciri ve son bakiye üstteki bakiyeyle tutmalı
  for (let i = 1; i < raw.length; i++) {
    if (Math.abs(r2(raw[i - 1].balance + raw[i].amount) - raw[i].balance) > 0.005) throw new Error(`Ekstre doğrulanamadı: bakiye zinciri ${raw[i].date} satırında tutmuyor.`);
  }
  const final = tr(headBalance);
  if (Math.abs(raw.at(-1)!.balance - final) > 0.005) throw new Error(`Ekstre doğrulanamadı: son satır bakiyesi (${raw.at(-1)!.balance}) ekstre bakiyesiyle (${final}) tutmuyor.`);

  const rows: StatementRow[] = raw.map((x) => {
    const text = x.desc.join(" ");
    const isCardPay = /Kredi Kartı Borç Öde/i.test(x.name);
    const last4 = isCardPay ? text.match(/\*+(\d{4})\b/)?.[1] ?? null : null;
    const fast = text.match(/(?:GİDEN FAST|GELEN FAST) - (.+?) TARAFINDAN/i)?.[1];
    const pos = text.match(/ISLEM NO\s*:\s*-?\s*(.+?)\s+[A-Z]{2}\*{2,}/i)?.[1];
    const merchant = isCardPay ? "Kredi kartı ödemesi" : (pos ?? (fast ? `${x.name} · ${fast}` : x.name)).slice(0, 120);
    return {
      date: x.date, amount: x.amount, balanceAfter: x.balance, merchant, note: x.name, kind: isCardPay ? "card_payment" : "other", opType: x.name,
      cardLast4: last4, counterparty: fast ?? null, externalId: `vh:${x.no}`,
    };
  });
  const debit = r2(rows.filter((r) => r.amount < 0).reduce((a, r) => a - r.amount, 0));
  const credit = r2(rows.filter((r) => r.amount > 0).reduce((a, r) => a + r.amount, 0));
  return {
    bank: "anka-account", currency: "TRY", ibanLast4: accNo, periodFrom: range ? iso(range[1]) : rows[0].date, periodTo: range ? iso(range[2]) : rows.at(-1)!.date,
    startingBalance: r2(raw[0].balance - raw[0].amount), finalBalance: final, sumDebit: debit, sumCredit: credit, declaredCount: rows.length, rows, warnings: [],
  };
}

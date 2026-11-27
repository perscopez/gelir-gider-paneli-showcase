// Contoso Bank (Fabrikam Bank Account) PDF ekstre ayrıştırıcısı.
// Girdi: PDF sayfalarının satır satır metni (unpdf extractText, mergePages:false).
// Çıktı doğrulanır: işlem sayısı, toplam borç/alacak ve satır satır bakiye zinciri ekstredeki rakamlarla tutmalı.

export type StatementKind = "card" | "transfer_in" | "transfer_out" | "direct_debit" | "card_payment" | "other";

export type StatementRow = {
  date: string; // YYYY-MM-DD (işlem tarihi)
  amount: number; // işaretli: gider < 0
  balanceAfter: number;
  merchant: string; // listede gösterilecek ad
  note: string | null;
  kind: StatementKind;
  opType: string;
  cardLast4: string | null;
  counterparty: string | null;
  externalId: string; // tekrar içe aktarmayı önler
};

export type ParsedStatement = {
  bank: "contoso" | "anka-card" | "anka-debit" | "lale-card" | "anka-account";
  balanceKnown?: boolean; // false: ekstre bakiye vermiyor (debit özeti); bakiye karşılaştırması gösterilmez
  currency: string;
  ibanLast4: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  startingBalance: number;
  finalBalance: number;
  sumDebit: number;
  sumCredit: number;
  declaredCount: number;
  rows: StatementRow[];
  warnings: string[];
};

const DATE = /^(\d{2})\.(\d{2})\.(\d{4})$/;
const AMOUNT_LINE = /^(-?[\d,]*\d\.\d{2}) ([A-Z]{3}) (-?[\d,]*\d\.\d{2}) [A-Z]{3}$/;
const OP_TYPES = [
  "Card transactions", "Internal transfer", "Outgoing transfer", "Incoming transfer", "Direct debit",
  "Standing order", "Cash withdrawal", "ATM withdrawal", "Card refund", "Refund", "Fee", "Interest",
];
const UUID_START = /[0-9a-f]{8}-[0-9a-f]{4}-/i;

const num = (s: string) => Number(s.replace(/,/g, ""));
const iso = (d: string) => {
  const m = d.match(DATE)!;
  return `${m[3]}-${m[2]}-${m[1]}`;
};
// Karşı taraf alanında bazen adresin devamı gelir ("Ad Soyad Musterstraße 1 , 10115 Berlin"): adresi atarız.
const stripAddress = (s: string) =>
  s.replace(/\s+[\wäöüÄÖÜß.-]*(straße|strasse|str\.|weg|platz|allee|damm|ring|gasse)\b.*$/i, "").replace(/\s+\d{5}\b.*$/, "").trim();
const hash = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};
const labeled = (lines: string[], label: string) => {
  const i = lines.findIndex((l) => l.trim() === label);
  return i >= 0 ? lines[i + 1]?.trim() : undefined;
};

export function parseContoso(pages: string[]): ParsedStatement {
  const all = pages.flatMap((p) => p.split(/\r?\n/)).map((l) => l.trim()).filter(Boolean);
  const warnings: string[] = [];

  if (!all.some((l) => l.includes("Contoso Bank")) || !all.some((l) => l.startsWith("Transaction date"))) {
    throw new Error("Bu dosya Contoso Bank/Fabrikam ekstresine benzemiyor.");
  }

  // ── Üst bilgi ──
  const money = (label: string) => {
    const v = labeled(all, label);
    const m = v?.match(/^(-?[\d,]*\d\.\d{2}) [A-Z]{3}$/);
    if (!m) throw new Error(`Ekstrede "${label}" bulunamadı.`);
    return num(m[1]);
  };
  const startingBalance = money("Starting balance");
  const finalBalance = money("Final balance");
  const sumDebit = money("Sum of debit");
  const sumCredit = money("Sum of credit");
  const currency = labeled(all, "Account currency") ?? "EUR";
  const iban = labeled(all, "Account number") ?? "";
  const countLine = all.find((l) => /Total number of transactions:/.test(l));
  const declaredCount = Number(countLine?.match(/(\d+)\s*$/)?.[1] ?? NaN);
  const range = all.find((l) => /^Date range:/.test(l)) ? labeled(all, "Date range:") : undefined;
  const rm = (range ?? all.find((l) => /^\d{2}\.\d{2}\.\d{4} - \d{2}\.\d{2}\.\d{4}$/.test(l)))?.match(/(\d{2}\.\d{2}\.\d{4}) - (\d{2}\.\d{2}\.\d{4})/);

  // ── İşlem satırları: başlıktan sonra, "Remark"a kadar; sayfa üst/alt bilgilerini at ──
  const hdr = all.findIndex((l) => l.startsWith("Booking date Participant"));
  if (hdr < 0) throw new Error("İşlem tablosu bulunamadı.");
  const body = all.slice(hdr + 1).filter((l) => !/^Issued on /.test(l) && !/^Remark$/.test(l) && !/^The document has been digitally/.test(l)
    && !/^Transaction date Description/.test(l) && !/^Booking date Participant/.test(l));

  const starts: number[] = [];
  for (let i = 0; i < body.length - 1; i++) if (DATE.test(body[i]) && DATE.test(body[i + 1])) { starts.push(i); i++; }

  const rows: StatementRow[] = [];
  for (let s = 0; s < starts.length; s++) {
    const block = body.slice(starts[s], s + 1 < starts.length ? starts[s + 1] : body.length);
    const am = block[block.length - 1].match(AMOUNT_LINE);
    if (!am) { warnings.push(`Satır okunamadı: ${block[0]}`); continue; }
    const amount = num(am[1]);
    const balanceAfter = num(am[3]);
    const mid = block.slice(2, -1).join(" ").replace(/\s+/g, " ");

    const uuidAt = mid.search(UUID_START);
    const head = (uuidAt >= 0 ? mid.slice(0, uuidAt) : mid).trim();
    const opType = OP_TYPES.find((t) => head.endsWith(t)) ?? head.split(" ").slice(-2).join(" ");
    const beforeType = head.slice(0, head.length - opType.length).trim();

    const cm = beforeType.match(/(\*\d{4}|---)\s+(.*)$/);
    const participant = (cm ? beforeType.slice(0, cm.index) : beforeType).trim();
    const cardLast4 = cm && cm[1] !== "---" ? cm[1].slice(1) : null;
    const title = (cm ? cm[2] : "").trim();

    let kind: StatementKind = "other";
    if (opType === "Card transactions" || opType === "Card refund") kind = "card";
    else if (opType === "Direct debit") kind = "direct_debit";
    else if (opType === "Internal transfer" || opType === "Incoming transfer") kind = "transfer_in";
    else if (opType === "Outgoing transfer") kind = "transfer_out";

    let merchant = title || participant;
    let counterparty: string | null = null;
    let note: string | null = null;
    if (kind !== "card") {
      // "DE88… 4274 Max Mustermann Adres …": IBAN (+ bölünmüş kuyruk) sonrası ad
      const name = stripAddress(participant.replace(/^[A-Z]{2}\d{2}[A-Z0-9]{8,}\s*(\d{1,4}\s+)?/, "").trim());
      counterparty = name || null;
      note = title || null;
      if (kind === "direct_debit") merchant = name || title;
      else merchant = name || title;
      if (/^Fabrikam M\d+/i.test(title)) merchant = `Fabrikam ${title.replace(/^Fabrikam\s*/i, "")} ödemesi`;
    }

    const date = iso(block[0]);
    rows.push({
      date, amount, balanceAfter, merchant: merchant.slice(0, 120), note: note?.slice(0, 200) ?? null, kind, opType,
      cardLast4, counterparty: counterparty?.slice(0, 120) ?? null,
      // Bakiye zinciri her satırı benzersiz yapar; aynı gün aynı tutar tekrarları da ayrışır.
      externalId: `uc:${iban.slice(-4)}:${date}:${amount.toFixed(2)}:${balanceAfter.toFixed(2)}:${hash(mid)}`,
    });
  }

  // ── Doğrulama ──
  const errors: string[] = [];
  if (Number.isFinite(declaredCount) && rows.length !== declaredCount) errors.push(`İşlem sayısı tutmuyor (ekstre ${declaredCount}, okunan ${rows.length}).`);
  const debit = Math.round(rows.filter((r) => r.amount < 0).reduce((a, r) => a - r.amount, 0) * 100) / 100;
  const credit = Math.round(rows.filter((r) => r.amount > 0).reduce((a, r) => a + r.amount, 0) * 100) / 100;
  if (Math.abs(debit - sumDebit) > 0.005) errors.push(`Toplam borç tutmuyor (ekstre ${sumDebit}, okunan ${debit}).`);
  if (Math.abs(credit - sumCredit) > 0.005) errors.push(`Toplam alacak tutmuyor (ekstre ${sumCredit}, okunan ${credit}).`);
  let running = startingBalance;
  for (const r of rows) {
    running = Math.round((running + r.amount) * 100) / 100;
    if (Math.abs(running - r.balanceAfter) > 0.005) { errors.push(`Bakiye zinciri ${r.date} tarihli "${r.merchant}" satırında bozuluyor.`); break; }
  }
  if (Math.abs(running - finalBalance) > 0.005 && !errors.length) errors.push("Son bakiye tutmuyor.");
  if (errors.length) throw new Error(`Ekstre doğrulanamadı: ${errors.join(" ")}`);

  return {
    bank: "contoso", currency, ibanLast4: iban ? iban.slice(-4) : null,
    periodFrom: rm ? iso(rm[1]) : null, periodTo: rm ? iso(rm[2]) : null,
    startingBalance, finalBalance, sumDebit, sumCredit, declaredCount, rows, warnings,
  };
}

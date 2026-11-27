import type { StatementRow } from "./contoso";

// Gmail'den gelen ekstre PDF'lerinin otomatik içe aktarması için saf yardımcılar (veritabanına dokunmaz, test edilebilir).
const fold = (s: string) => s.toLowerCase().replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c");

export type Acc = { id: string; name: string; institution: string | null; currency: string; type: string; match_keys?: string | null };
// Eşleştirmede kullanılan metin: ad + kurum + kullanıcının "eşleşme kelimeleri" (hesabı yeniden adlandırınca eşleşme bozulmasın).
export const accText = (a: Pick<Acc, "name" | "institution" | "match_keys">) => `${a.name} ${a.institution ?? ""} ${a.match_keys ?? ""}`;

// Anka Bank vadesiz (TL banka) hesabı: kart ödemelerinin kaynağı ve debit harcamalarının hesabı.
export const findAnkaBank = (accounts: Acc[]) =>
  accounts.find((a) => a.currency === "TRY" && (a.type === "bank" || a.type === "cash") && fold(accText(a)).includes("anka")) ?? null;

// Kredi kartı hesabı: adında/kurumunda kartın son 4 hanesi geçen; yoksa tek Anka Bank TRY kredi kartı hesabı; yoksa null (hesap otomatik açılır).
export function findCardAccount(accounts: Acc[], last4: string | null): Acc | null {
  const cards = accounts.filter((a) => a.type === "credit_card" && a.currency === "TRY");
  if (last4) { const hit = cards.find((a) => accText(a).includes(last4)); if (hit) return hit; }
  // Tek yedek: yalnızca adı/kurumu Anka Bank olan tek kart (başka bankanın kartına yanlış yazılmasın)
  const ankaCards = cards.filter((a) => fold(accText(a)).includes("anka"));
  return ankaCards.length === 1 ? ankaCards[0] : null;
}

export type Existing = { id: string; occurred_on: string; amount: number | string; kind: string; external_id: string | null; source: string; merchant?: string | null };
export type Plan = { fresh: StatementRow[]; reconciled: { row: StatementRow; existingId: string; link: boolean; settle: boolean }[]; duplicates: StatementRow[] };

const dayDiff = (a: string, b: string) => Math.abs(new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 864e5;

// Her satır: zaten içe aktarılmış (aynı kimlik) → atla; başka yoldan girilmiş (Apple Pay, e-posta, elle: aynı tutar ±3 gün) → yeni kayıt açma, mevcut kaydı ekstre kimliğine bağla; aksi halde yeni.
export function planRows(rows: StatementRow[], existing: Existing[], seen: Set<string>, matches: (row: StatementRow, e: Existing) => boolean): Plan {
  const pool = [...existing];
  const plan: Plan = { fresh: [], reconciled: [], duplicates: [] };
  for (const row of rows) {
    if (seen.has(row.externalId)) { plan.duplicates.push(row); continue; }
    // Tekrarlayan kural kaydı yer tutucudur: ekstrede tutar biraz farklı (±%15) ya da tarih birkaç gün kaymış olabilir; yeni kayıt açmak yerine gerçek değerle düzeltilir.
    const abs = Math.abs(row.amount);
    const hit = pool.findIndex((e) => {
      const rec = e.source === "recurring";
      const amountOk = rec ? Math.abs(Number(e.amount) - abs) <= abs * 0.15 : Math.abs(Number(e.amount) - abs) < 0.005;
      return amountOk && dayDiff(e.occurred_on, row.date) <= (rec ? 5 : 3) && matches(row, e);
    });
    if (hit >= 0) {
      const e = pool.splice(hit, 1)[0];
      plan.reconciled.push({ row, existingId: e.id, link: !e.external_id, settle: e.source === "recurring" });
    } else plan.fresh.push(row);
  }
  return plan;
}

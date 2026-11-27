export type PreviewRow = {
  idx: number;
  date: string;
  amount: number; // işaretli
  merchant: string;
  note: string | null;
  kind: "card" | "transfer_in" | "transfer_out" | "direct_debit" | "card_payment" | "other";
  categoryId: string | null;
  status: "new" | "duplicate" | "maybe";
  matchedWith: string | null; // "maybe" için: eşleşen mevcut kayıt
  fromBlocked: boolean; // Fabrikam ödemesi bloke hesaptan transfer olarak işlenebilir
  isPayment?: boolean; // kredi kartı ödemesi: kaynak hesaptan karta transfer olarak yazılır
};

export type PreviewData = {
  currency: string;
  periodFrom: string | null;
  periodTo: string | null;
  startingBalance: number;
  finalBalance: number;
  ibanLast4: string | null;
  rows: PreviewRow[];
  accountBalance: number; // hesabın ekstre bitiş tarihi (asOf) itibarıyla bakiyesi
  asOf: string;
  accountOpening: number;
  blockedAccountName: string | null;
  statementKind: "contoso" | "anka-card" | "anka-debit" | "lale-card" | "anka-account";
  balanceKnown: boolean; // false: ekstre bakiye vermiyor (debit özeti)
  paymentSource: string | null; // kart ödemeleri için seçilen kaynak hesap adı
  card: { last4: string | null; limit: number | null; cutoff: string | null; dueDate: string | null; minPayment: number | null; debt: number } | null;
};

export type PreviewResult = { ok: true; data: PreviewData } | { ok: false; error: string };
export type CommitResult = { ok: true; imported: number; skipped: number } | { ok: false; error: string };

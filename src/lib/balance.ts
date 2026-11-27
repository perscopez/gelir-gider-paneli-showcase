// Bir hesabın belirli bir tarih itibarıyla bakiyesi: açılış + gelirler − giderler − çıkan transferler + gelen transferler.
export type BalanceRow = { kind: string; amount: number | string; to_amount: number | string | null; account_id: string; to_account_id: string | null };

export function balanceFrom(opening: number, accountId: string, rows: BalanceRow[]): number {
  let b = opening;
  for (const r of rows) {
    if (r.account_id === accountId) b += r.kind === "income" ? Number(r.amount) : -Number(r.amount);
    if (r.kind === "transfer" && r.to_account_id === accountId) b += Number(r.to_amount ?? 0);
  }
  return Math.round(b * 100) / 100;
}

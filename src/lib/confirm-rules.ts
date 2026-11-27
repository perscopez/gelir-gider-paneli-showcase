import { addMonthsKey, dueDateISO } from "@/lib/date";

// "Sadece hatırlat" gider kuralları (örn. kira: ev sahibine ödemeyi sen yaparsın) onaylı hatırlatma olur:
// vadeden `remind_days_before` gün önce başlayıp her gün Telegram'a "✅ Ödedim" tuşlu mesaj gönderilir, sen tuşa basana kadar (gecikse de) sürer.
// Tuşa basınca ödeme kaydı oluşur ve kural o vadeyi kapatır (last_run_on).
export type ConfirmRule = {
  id: string; name: string; kind: string; amount: number | string; currency: string; day_of_month: number;
  start_date: string; end_date: string | null; last_run_on: string | null; remind_days_before: number; auto_create: boolean; active: boolean;
};

export const isConfirmRule = (r: Pick<ConfirmRule, "auto_create" | "kind" | "active">) => r.active && !r.auto_create && r.kind === "expense";

const dayDiff = (a: string, b: string) => Math.round((new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 864e5);

// Ödenmemiş en eski vade (geçen ay, bu ay, gelecek ay arasında). Hatırlatma penceresine girmediyse null.
export function pendingDue(r: ConfirmRule, today: string): { due: string; daysUntil: number } | null {
  const thisKey = today.slice(0, 7);
  for (const key of [addMonthsKey(thisKey, -1), thisKey, addMonthsKey(thisKey, 1)]) {
    const due = dueDateISO(key, r.day_of_month);
    if (due < r.start_date) continue;
    if (r.end_date && due > r.end_date) continue;
    if (r.last_run_on && due <= r.last_run_on) continue;
    const days = dayDiff(due, today);
    return days > r.remind_days_before ? null : { due, daysUntil: days };
  }
  return null;
}

const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
export function reminderText(name: string, amountText: string, due: string, daysUntil: number): string {
  const when = daysUntil > 1 ? `${daysUntil} gün sonra (${dm(due)})` : daysUntil === 1 ? `yarın (${dm(due)})` : daysUntil === 0 ? `bugün (${dm(due)})` : `${-daysUntil} gün GECİKTİ (${dm(due)})`;
  return `${daysUntil < 0 ? "⚠" : "⏰"} ${name} ${when}: ${amountText}\nÖdeyip dekontu ev sahibine gönderince aşağıdaki tuşa bas, kaydı ben yazarım.`;
}

export const paidData = (ruleId: string, due: string) => `paid:${ruleId}:${due}`;
export function parsePaidData(data: string | undefined): { ruleId: string; due: string } | null {
  const m = data?.match(/^paid:([0-9a-f-]{36}):(\d{4}-\d{2}-\d{2})$/i);
  return m ? { ruleId: m[1], due: m[2] } : null;
}

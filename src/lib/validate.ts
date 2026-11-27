import { todayISO } from "@/lib/date";

// Form girdilerini sınırlar: makul tutar, geçerli tarih, kısaltılmış metin.
export const toNum = (v: FormDataEntryValue | null | undefined) => Number(String(v ?? "").trim().replace(/\s/g, "").replace(",", "."));

export function amountOrThrow(v: FormDataEntryValue | null | undefined, label = "Tutar") {
  const n = toNum(v);
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000_000) throw new Error(`${label} 0'dan büyük ve makul bir sayı olmalı.`);
  return Math.round(n * 100) / 100;
}

export function dateOrToday(v: FormDataEntryValue | null | undefined) {
  const s = String(v ?? "").trim();
  if (!s) return todayISO();
  const y = Number(s.slice(0, 4));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s)) || y < 2000 || y > 2100) throw new Error("Tarih geçersiz.");
  return s;
}

export const text = (v: FormDataEntryValue | null | undefined, max = 120) => String(v ?? "").trim().slice(0, max);

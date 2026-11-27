import { adminClient } from "@/lib/supabase/admin";

// 1 EUR = x TRY. Kaynak: ECB verisi (frankfurter). Gün içi bakılırsa DB'deki son kur kullanılır.
export async function fetchEurTry(): Promise<{ day: string; rate: number }> {
  const res = await fetch(process.env.FX_API_URL ?? "https://api.frankfurter.dev/v1/latest?base=EUR&symbols=TRY", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`kur alınamadı: ${res.status}`);
  const j = (await res.json()) as { date: string; rates: { TRY: number } };
  return { day: j.date, rate: j.rates.TRY };
}

export async function refreshFx() {
  const { day, rate } = await fetchEurTry();
  await adminClient().from("fx_rates").upsert({ day, eur_try: rate });
  return rate;
}

export async function latestRate(db: ReturnType<typeof adminClient>): Promise<number> {
  const { data } = await db.from("fx_rates").select("eur_try").order("day", { ascending: false }).limit(1).maybeSingle();
  if (data) return Number(data.eur_try);
  return refreshFx();
}

// İşlem gününün kuru: önce fx_rates tablosunda o güne en yakın (≤ gün, en çok 7 gün öncesi) kayıt, yoksa tarihsel ECB kuru, o da olmazsa verilen/son kur.
export async function historicalRate(date: string, f: typeof fetch = fetch): Promise<number | null> {
  try {
    const url = process.env.FX_API_URL ? process.env.FX_API_URL.replace("/latest", `/${date}`) : `https://api.frankfurter.dev/v1/${date}?base=EUR&symbols=TRY`;
    const res = await f(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { rates?: { TRY?: number } };
    return j.rates?.TRY ?? null;
  } catch {
    return null;
  }
}

type RateDb = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
export async function rateForDate(db: RateDb, date: string, fallback?: number, f: typeof fetch = fetch): Promise<number> {
  const { data } = await db.from("fx_rates").select("day,eur_try").lte("day", date).order("day", { ascending: false }).limit(1).maybeSingle();
  if (data && (new Date(`${date}T00:00:00Z`).getTime() - new Date(`${data.day}T00:00:00Z`).getTime()) / 864e5 <= 7) return Number(data.eur_try);
  const h = await historicalRate(date, f);
  if (h) return h;
  if (fallback) return fallback;
  if (data) return Number(data.eur_try);
  const { data: latest } = await db.from("fx_rates").select("eur_try").order("day", { ascending: false }).limit(1).maybeSingle();
  return latest ? Number(latest.eur_try) : 0;
}

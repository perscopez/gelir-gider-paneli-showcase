// Tarih işlemleri uygulamanın saat diliminde yapılır (varsayılan Europe/Berlin, APP_TZ ile değişir).
// Sunucu UTC'de çalıştığı için `new Date().toISOString()` gece yarısından sonraki 1-2 saatte yanlış güne/aya düşerdi.
const TZ = process.env.APP_TZ || "Europe/Berlin";
const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

export const todayISO = (d: Date = new Date()) => ymd.format(d); // YYYY-MM-DD
export const monthKey = (d: Date = new Date()) => todayISO(d).slice(0, 7); // YYYY-MM
export const monthStartISO = (d: Date = new Date()) => `${monthKey(d)}-01`;

export function addDaysISO(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function addMonthsKey(key: string, n: number) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

// Ayın günü o ayda yoksa (31 → şubat) ayın son gününe sabitler.
export function dueDateISO(monthKeyStr: string, day: number) {
  const [y, m] = monthKeyStr.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${monthKeyStr}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

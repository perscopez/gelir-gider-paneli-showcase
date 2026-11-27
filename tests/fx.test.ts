import { describe, expect, it } from "vitest";
import { historicalRate, rateForDate } from "@/lib/fx";

const dbWith = (row: { day: string; eur_try: number } | null, latest = row) => ({
  from: () => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "lte", "order", "limit"]) q[m] = () => q;
    q.maybeSingle = () => Promise.resolve({ data: row ?? latest });
    return q;
  },
});
const api = (rate: number | null) => (async () => (rate === null ? new Response("x", { status: 500 }) : new Response(JSON.stringify({ rates: { TRY: rate } })))) as unknown as typeof fetch;

describe("rateForDate", () => {
  it("veritabanında 7 gün içinde kayıt varsa onu kullanır", async () => expect(await rateForDate(dbWith({ day: "2026-11-10", eur_try: 50 }), "2026-11-14", undefined, api(99))).toBe(50));
  it("kayıt çok eskiyse tarihsel kura gider", async () => expect(await rateForDate(dbWith({ day: "2026-10-01", eur_try: 50 }), "2026-11-14", undefined, api(55))).toBe(55));
  it("hiç kayıt yoksa tarihsel kur", async () => expect(await rateForDate(dbWith(null, null), "2026-05-05", undefined, api(40))).toBe(40));
  it("tarihsel kur alınamazsa verilen yedek, o da yoksa son kayıt", async () => {
    expect(await rateForDate(dbWith(null, null), "2026-05-05", 36.4, api(null))).toBe(36.4);
    expect(await rateForDate(dbWith({ day: "2026-10-01", eur_try: 50 }), "2026-11-14", undefined, api(null))).toBe(50);
  });
});

describe("historicalRate", () => {
  it("başarısızlıkta null", async () => expect(await historicalRate("2026-01-01", api(null))).toBeNull());
  it("ağ hatasında null", async () => expect(await historicalRate("2026-01-01", (async () => { throw new Error("net"); }) as unknown as typeof fetch)).toBeNull());
});

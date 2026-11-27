import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { findDeals } from "@/lib/kaufda";

export const maxDuration = 20;
const clean = (s: string | null, n: number) => (s ?? "").replace(/[^\p{L}\p{N} .&'%,-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, n);

// Bir ürün için KaufDA fırsatları (oturum gerekir). ppb/unit: kendi ödediğin birim fiyat (tasarruf hesabı için).
export async function GET(req: Request) {
  const { data } = await (await createClient()).auth.getUser();
  if (!data.user) return new NextResponse("unauthorized", { status: 401 });
  const u = new URL(req.url);
  const name = clean(u.searchParams.get("name"), 60);
  if (!name) return NextResponse.json({ url: null, offers: [] });
  const ppb = Number(u.searchParams.get("ppb"));
  const res = await findDeals({ name, brand: clean(u.searchParams.get("brand"), 40) || null, ppb: ppb > 0 ? ppb : null, unit: clean(u.searchParams.get("unit"), 5) || null });
  return NextResponse.json(res, { headers: { "Cache-Control": "private, max-age=3600" } });
}

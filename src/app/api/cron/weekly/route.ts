import { NextResponse } from "next/server";
import { bearer, safeEqual } from "@/lib/auth-secret";
import { balancesText, periodSummary } from "@/lib/summary";
import { notify } from "@/lib/notify";
import { adminClient, ownerId } from "@/lib/supabase/admin";
import { buildBackup, summarizeBackup } from "@/lib/backup";
import { todayISO } from "@/lib/date";

export const maxDuration = 60;
const KEEP = 8; // son 8 haftalık yedek saklanır

// Tam yedeği özel "backups" Storage kovasına yazar (yoksa oluşturur), eskileri siler. Başarıyı/hatayı döner.
async function storeBackup(): Promise<string> {
  try {
    const db = adminClient();
    const backup = await buildBackup(db, ownerId());
    const { error: bErr } = await db.storage.getBucket("backups");
    if (bErr) await db.storage.createBucket("backups", { public: false });
    const path = `${ownerId()}/yedek-${todayISO()}.json`;
    const up = await db.storage.from("backups").upload(path, JSON.stringify(backup), { contentType: "application/json", upsert: true });
    if (up.error) throw new Error(up.error.message);
    const { data: files } = await db.storage.from("backups").list(ownerId(), { limit: 100, sortBy: { column: "name", order: "desc" } });
    const old = (files ?? []).slice(KEEP).map((f) => `${ownerId()}/${f.name}`);
    if (old.length) await db.storage.from("backups").remove(old);
    return `💾 Haftalık yedek alındı (${summarizeBackup(backup)})${backup.missing.length ? `\nAtlanan tablolar: ${backup.missing.join(", ")}` : ""}`;
  } catch (e) {
    return `⚠ Haftalık yedek alınamadı: ${(e as Error).message}`;
  }
}

export async function GET(req: Request) {
  if (!safeEqual(bearer(req), process.env.CRON_SECRET)) return new NextResponse("forbidden", { status: 403 });
  const backupLine = await storeBackup();
  await notify("Haftalık özet", `${await periodSummary(7)}\n\n${await balancesText()}\n\n${backupLine}`);
  return NextResponse.json({ ok: true, backup: backupLine });
}

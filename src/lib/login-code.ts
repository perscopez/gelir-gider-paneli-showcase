import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { adminClient, ownerId } from "@/lib/supabase/admin";

// Giriş kodunu biz üretir, saklar (sadece HMAC özeti, sahibin app_metadata'sında) ve doğrularız.
// Supabase'in kendi e-posta OTP doğrulamasına bağımlı değiliz; doğrulanınca oturum token_hash ile açılır.
const TTL_MS = 10 * 60_000;
const MAX_TRIES = 5;
const THROTTLE_MS = 45_000;
// Her yeni kod deneme sayacını sıfırladığı için saatlik üst sınır: tahmin denemesi saatte en çok MAX_CODES_PER_HOUR × MAX_TRIES.
const MAX_CODES_PER_HOUR = 6;
const HOUR_MS = 60 * 60_000;

const mac = (code: string) => createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").update(code).digest("hex");
const CLEARED = { login_code_hash: null, login_code_exp: null, login_code_tries: null };

async function meta() {
  const { data } = await adminClient().auth.admin.getUserById(ownerId());
  return (data?.user?.app_metadata ?? {}) as Record<string, unknown>;
}
const save = (m: Record<string, unknown>) => adminClient().auth.admin.updateUserById(ownerId(), { app_metadata: m });

export async function issueLoginCode(): Promise<{ status: "throttled" } | { status: "ok"; code: string }> {
  const m = await meta();
  const now = Date.now();
  if (now - Number(m.last_code_at ?? 0) <= THROTTLE_MS) return { status: "throttled" };
  const inWindow = now - Number(m.code_window_at ?? 0) < HOUR_MS;
  const count = inWindow ? Number(m.code_window_count ?? 0) : 0;
  if (count >= MAX_CODES_PER_HOUR) return { status: "throttled" };
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await save({
    login_code_hash: mac(code), login_code_exp: now + TTL_MS, login_code_tries: 0, last_code_at: now,
    code_window_at: inWindow ? Number(m.code_window_at) : now, code_window_count: count + 1,
  });
  return { status: "ok", code };
}

export const clearLoginCode = () => save(CLEARED);

export type CodeCheck = "ok" | "bad" | "expired" | "locked" | "none";

export async function checkLoginCode(code: string): Promise<CodeCheck> {
  const m = await meta();
  const hash = typeof m.login_code_hash === "string" ? m.login_code_hash : null;
  if (!hash) return "none";
  if (Date.now() > Number(m.login_code_exp ?? 0)) { await save(CLEARED); return "expired"; }
  const tries = Number(m.login_code_tries ?? 0);
  if (tries >= MAX_TRIES) return "locked";
  const a = Buffer.from(mac(code), "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    await save({ login_code_tries: tries + 1 });
    return tries + 1 >= MAX_TRIES ? "locked" : "bad";
  }
  await save(CLEARED); // tek kullanımlık
  return "ok";
}

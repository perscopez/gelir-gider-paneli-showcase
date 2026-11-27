import { revalidatePath } from "next/cache";

export type Result = { ok: true } | { ok: false; error: string };

// Server action gövdesini sarar: hata fırlatmak yerine kullanıcıya gösterilecek mesaj döner.
export async function run(fn: () => Promise<void>): Promise<Result> {
  try {
    await fn();
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendly((e as Error).message) };
  }
}

function friendly(msg: string) {
  if (msg.includes("duplicate key")) return "Bu kayıt zaten var.";
  if (msg.includes("violates foreign key")) return "Bu kayıt başka kayıtlarda kullanılıyor.";
  if (msg.includes("row-level security")) return "Yetki hatası: tekrar giriş yap.";
  return msg;
}

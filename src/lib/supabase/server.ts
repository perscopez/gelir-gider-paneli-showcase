import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { demoFetch } from "@/lib/demo/fetch";

export const DEMO_COOKIE = "demo";
export const isDemo = async () => (await cookies()).get(DEMO_COOKIE)?.value === "1";

export async function createClient() {
  const cookieStore = await cookies();
  const demo = cookieStore.get(DEMO_COOKIE)?.value === "1";
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Gösterim modu: veri okumaları uydurma veri setinden gelir, yazma kapalıdır (oturum istekleri gerçek).
      ...(demo ? { global: { fetch: demoFetch(fetch) } } : {}),
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) => cookieStore.set(name, value, { ...options, httpOnly: true })); // oturum çerezi tarayıcı JS'ine kapalı
          } catch {
            // Server Component içinden çağrıldı; proxy oturumu zaten yeniliyor.
          }
        },
      },
    },
  );
}

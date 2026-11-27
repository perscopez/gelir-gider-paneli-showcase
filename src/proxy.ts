import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Giriş zorunlu + sadece OWNER_EMAIL. Webhook/cron yolları kendi gizli anahtarlarıyla korunur.
const PUBLIC = ["/login", "/auth", "/api/telegram", "/api/ingest", "/api/cron", "/manifest.webmanifest", "/icon", "/apple-icon"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Tam yol ya da alt yol eşleşmesi: "/api/telegram-x" gibi benzer adlar korumasız kalmasın.
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, { ...options, httpOnly: true }));
        },
      },
    },
  );

  const { data } = await supabase.auth.getUser();
  const owner = process.env.OWNER_EMAIL?.toLowerCase();
  const email = data.user?.email?.toLowerCase();

  if (!data.user || !owner || email !== owner) {
    if (data.user) await supabase.auth.signOut();
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};

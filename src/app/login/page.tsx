import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import { sendMail } from "@/lib/notify";
import { checkLoginCode, clearLoginCode, issueLoginCode } from "@/lib/login-code";
import { getLocale, t } from "@/lib/i18n";
import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";

const isOwner = (email: string) => !!email && email === process.env.OWNER_EMAIL?.toLowerCase();

// 1) Giriş kodunu e-postayla gönderir. Kodu biz üretip saklarız (src/lib/login-code.ts), e-postayı Resend ile yollarız.
//    Resend ayarlı değilse veya gönderilemezse Supabase'in kendi e-postasına (bağlantı) düşer.
async function requestCode(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  let throttled = false;
  // Başkasının e-postası için sessizce aynı cevabı ver: hesap varlığı sızmasın.
  if (isOwner(email)) {
    const h = await headers();
    const origin = process.env.APP_URL?.replace(/\/+$/, "") || (h.get("origin") ?? `https://${h.get("host")}`);
    const viaSupabase = async () => {
      const supabase = await createClient();
      await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/callback` } });
    };

    if (!process.env.RESEND_API_KEY) {
      await viaSupabase();
    } else {
      const r = await issueLoginCode(); // 45 sn içinde tekrar kod üretmez
      if (r.status === "throttled") throttled = true;
      else {
        const sent = await sendMail(email, `Giriş kodun: ${r.code}`, `Gelir Gider paneline giriş kodun: ${r.code}\n\nKod 10 dakika geçerlidir; yeni kod istersen bu kod geçersiz olur. Sen istemediysen bu e-postayı yok say.`);
        if (!sent) {
          console.error("login: kod e-postası gönderilemedi, Supabase yedeğine düşülüyor");
          await clearLoginCode();
          await viaSupabase();
        }
      }
    }
  }
  (await cookies()).set("login_email", email, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, path: "/login" });
  redirect(throttled ? "/login?sent=1&wait=1" : "/login?sent=1");
}

// 2) Kodu doğrular (hangi tarayıcıda yazıldığı önemli değil). Doğruysa oturum Supabase'in token_hash yoluyla açılır.
async function verifyCode(formData: FormData) {
  "use server";
  const jar = await cookies();
  const email = (jar.get("login_email")?.value ?? String(formData.get("email") ?? "")).trim().toLowerCase();
  const code = String(formData.get("code") ?? "").replace(/\s/g, "");
  if (!isOwner(email) || !/^\d{6,10}$/.test(code)) redirect("/login?sent=1&error=bad");

  const supabase = await createClient();
  const check = await checkLoginCode(code);
  if (check === "ok") {
    const { data, error: genErr } = await adminClient().auth.admin.generateLink({ type: "magiclink", email });
    const tokenHash = data?.properties?.hashed_token;
    let verr: unknown = genErr ?? (tokenHash ? null : new Error("hashed_token yok"));
    if (!verr && tokenHash) {
      let { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
      if (error) ({ error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "email" }));
      verr = error;
    }
    if (verr) {
      console.error("login: oturum açılamadı", (verr as { code?: string; message?: string }).code, (verr as { message?: string }).message);
      redirect("/login?sent=1&error=session");
    }
    jar.delete({ name: "login_email", path: "/login" });
    redirect("/");
  }
  if (check === "none") {
    // Kendi kodumuz yok: Supabase'in e-posta koduyla (yedek yol) dene.
    let { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
    if (error) ({ error } = await supabase.auth.verifyOtp({ email, token: code, type: "magiclink" }));
    if (!error) {
      jar.delete({ name: "login_email", path: "/login" });
      redirect("/");
    }
    redirect("/login?sent=1&error=bad");
  }
  redirect(`/login?sent=1&error=${check}`);
}

export const metadata = { title: "Giriş" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const L = t(await getLocale());
  const haveEmail = !!(await cookies()).get("login_email")?.value;
  const field = "h-11 w-full rounded-lg border border-input bg-background px-3 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
  const label = "grid gap-1.5 text-sm";
  const labelText = "text-xs font-medium text-muted-foreground";
  return (
    <main className="grid min-h-screen place-items-center bg-gradient-to-br from-background via-background to-muted px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-7 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Wallet className="size-5" aria-hidden /></span>
          <h1 className="text-xl font-semibold tracking-tight">{L.appName}</h1>
        </div>
        {sp.sent ? (
          <div className="flex flex-col gap-4">
            <p className="rounded-lg border bg-muted/40 p-3 text-sm">{L.codeSent}</p>
            {sp.wait && <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">{L.codeWait}</p>}
            <form action={verifyCode} className="flex flex-col gap-4">
              {!haveEmail && (
                <label className={label}>
                  <span className={labelText}>{L.emailLabel}</span>
                  <input name="email" type="email" required autoComplete="email" className={field} />
                </label>
              )}
              <label className={label}>
                <span className={labelText}>{L.codeLabel}</span>
                <input name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,12}" maxLength={12} autoFocus className={`${field} text-center text-lg tracking-[0.4em]`} />
              </label>
              {sp.error && (
                <p className="text-sm text-destructive" role="alert">
                  {sp.error === "expired" ? L.codeExpired : sp.error === "locked" ? L.codeLocked : sp.error === "session" ? L.codeSession : L.badCode}
                </p>
              )}
              <Button type="submit" size="lg" className="h-11">{L.login}</Button>
            </form>
            <a href="/login" className="text-center text-xs text-muted-foreground underline">{L.resend}</a>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{L.loginHint}</p>
            <form action={requestCode} className="flex flex-col gap-4">
              <label className={label}>
                <span className={labelText}>{L.emailLabel}</span>
                <input name="email" type="email" required autoComplete="email" className={field} />
              </label>
              <Button type="submit" size="lg" className="h-11">{L.sendLink}</Button>
            </form>
          </div>
        )}
      </div>
    </main>
  );
}

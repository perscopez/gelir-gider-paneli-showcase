import { headers } from "next/headers";
import { CheckCircle2, Circle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/i18n";
import { PageHeader } from "@/components/page-header";
import { CopyButton } from "@/components/copy-button";
import { Badge } from "@/components/ui/badge";
import { ProviderTest } from "@/components/provider-test";
import { receiptProviders } from "@/lib/receipt";
import { telegramCheck, telegramEnableButtons, testProvider } from "./actions";
import { GMAIL_BRIDGE_SCRIPT } from "@/lib/gmail-bridge-script";

const L = (tr: boolean, a: string, b: string) => (tr ? a : b);

export const metadata = { title: "Bağlantılar" };

type Item = { name: string; desc: string; ready: boolean; missing?: string; source?: string; steps?: string[] };

export default async function IntegrationsPage() {
  const locale = await getLocale();
  const tr = locale === "tr";
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const env = (k: string) => !!process.env[k];

  const supabase = await createClient();
  const { data: last } = await supabase.from("transactions").select("source,created_at").order("created_at", { ascending: false }).limit(300);
  const lastBy = new Map<string, string>();
  for (const r of last ?? []) if (!lastBy.has(r.source)) lastBy.set(r.source, r.created_at);
  const when = (src?: string) => {
    const v = src ? lastBy.get(src) : undefined;
    return v ? new Date(v).toLocaleString(tr ? "tr-TR" : "en-GB", { dateStyle: "medium", timeStyle: "short" }) : null;
  };

  const active = receiptProviders();
  const providers: { id: "gemini" | "groq"; name: string; ready: boolean; note: string; steps: string[]; env: string }[] = [
    { id: "gemini", name: "Google Gemini", ready: env("GEMINI_API_KEY"), note: L(tr, "Fotoğraf ve PDF okur. Ücretsiz katman günlük kotalıdır.", "Reads photos and PDFs. The free tier has a daily quota."),
      steps: [L(tr, "aistudio.google.com/apikey adresinden ücretsiz anahtar al.", "Get a free key at aistudio.google.com/apikey."), L(tr, "Vercel → Settings → Environment Variables: GEMINI_API_KEY olarak ekle.", "Vercel → Settings → Environment Variables: add as GEMINI_API_KEY."), L(tr, "Yeniden dağıt (Redeploy).", "Redeploy.")], env: "GEMINI_API_KEY=..." },
    { id: "groq", name: "Groq", ready: env("GROQ_API_KEY"), note: L(tr, "Çok hızlı; yalnızca fotoğraf okur (PDF okumaz, 3 MB altı). Ücretsiz katmanda dakika/gün sınırı vardır.", "Very fast; photos only (no PDFs, under 3 MB). The free tier has per-minute/day limits."),
      steps: [L(tr, "console.groq.com/keys adresinden ücretsiz API anahtarı oluştur.", "Create a free API key at console.groq.com/keys."), L(tr, "Vercel → Settings → Environment Variables: GROQ_API_KEY olarak ekle.", "Vercel → Settings → Environment Variables: add as GROQ_API_KEY."), L(tr, "İstersen RECEIPT_PROVIDER=groq ile Groq'u öne al (varsayılan: Gemini önce).", "Optionally set RECEIPT_PROVIDER=groq to prefer Groq (default: Gemini first)."), L(tr, "Yeniden dağıt (Redeploy).", "Redeploy.")], env: "GROQ_API_KEY=gsk_...\nRECEIPT_PROVIDER=groq   # opsiyonel: auto | gemini | groq" },
  ];
  const items: Item[] = [
    { name: "Telegram", desc: tr ? "Mesajla gider yaz, fiş/PDF fotoğrafı at; bildirimler buraya gelir." : "Log expenses by message, send receipt photos; notifications arrive here.",
      ready: env("TELEGRAM_BOT_TOKEN") && env("TELEGRAM_CHAT_ID"), missing: "TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID", source: "telegram" },
    { name: "Apple Pay", desc: tr ? "iPhone Kısayollar otomasyonu ödemeyi anında kaydeder." : "iPhone Shortcuts automation records each payment instantly.",
      ready: env("INGEST_SECRET"), missing: "INGEST_SECRET", source: "apple_pay",
      steps: [`POST ${origin}/api/ingest`, "Authorization: Bearer <INGEST_SECRET>", `{ "amount": "€12,50", "merchant": "Lidl", "card": "Fabrikam" }`] },
    { name: "Gmail (Anka Bank)", desc: tr ? "Anka Bank bildirimleri ve ekstre PDF'leri otomatik işlenir: gelen/giden FAST, debit harcaması, kredi kartı ekstresi (harcamalar + ödeme). Hatırlatmalar ve ekstre özeti Telegram'a gelir." : "Anka Bank notifications and statement PDFs are processed automatically: incoming/outgoing FAST, debit card purchases, credit card statements (purchases + payment). Reminders and statement summaries arrive as notifications.",
      ready: env("INGEST_SECRET"), missing: "INGEST_SECRET", source: "email",
      steps: [tr ? "script.google.com'da yeni proje aç, aşağıdaki kodu yapıştır." : "Create a project at script.google.com and paste the code below.",
        "Script properties: PANEL_URL = " + origin, tr ? "Script properties: INGEST_SECRET = Vercel'deki ile aynı değer" : "Script properties: INGEST_SECRET = same value as in Vercel",
        tr ? "\"kur\" fonksiyonunu çalıştır ve izinleri onayla." : "Run the \"kur\" function and grant permissions."] },
    { name: tr ? "E-posta (Resend)" : "Email (Resend)", desc: tr ? "Giriş kodu ve haftalık özet e-postaları." : "Login codes and weekly summary emails.",
      ready: env("RESEND_API_KEY"), missing: "RESEND_API_KEY" },
    { name: tr ? "Zamanlanmış görevler" : "Scheduled jobs", desc: tr ? "Günlük tekrarlayan işlemler ve haftalık özet (Vercel Cron)." : "Daily recurring transactions and weekly digest (Vercel Cron).",
      ready: env("CRON_SECRET"), missing: "CRON_SECRET" },
  ];

  return (
    <div className="max-w-3xl">
      <PageHeader title={L(tr, "Bağlantılar", "Integrations")} description={L(tr, "Paneli besleyen otomasyonlar ve durumları.", "Automations that feed the panel, and their status.")} />
      <ul className="space-y-4">
        {items.map((it) => {
          const at = when(it.source);
          return (
            <li key={it.name} className="rounded-xl border bg-card p-5 shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-medium">
                  {it.ready ? <CheckCircle2 className="size-4 text-emerald-500" aria-hidden /> : <Circle className="size-4 text-muted-foreground" aria-hidden />}
                  {it.name}
                </div>
                <Badge variant={it.ready ? "secondary" : "outline"}>{it.ready ? L(tr, "Hazır", "Ready") : L(tr, "Ayar eksik", "Not configured")}</Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{it.desc}</p>
              {!it.ready ? <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{L(tr, "Vercel ortam değişkeni gerekli", "Needs Vercel env var")}: <code>{it.missing}</code></p> : null}
              {it.source ? <p className="mt-2 text-xs text-muted-foreground">{at ? `${L(tr, "Son kayıt", "Last record")}: ${at}` : L(tr, "Henüz kayıt yok", "No records yet")}</p> : null}
              {it.steps ? <pre className="mt-3 overflow-x-auto rounded-lg bg-muted p-3 text-xs leading-relaxed whitespace-pre-wrap">{it.steps.join("\n")}</pre> : null}
              {it.name === "Telegram" && it.ready ? (
                <div className="mt-3 space-y-2">
                  <ProviderTest provider="telegram" label={L(tr, "Webhook durumunu kontrol et", "Check webhook")} action={telegramCheck} />
                  <ProviderTest provider="telegram" label={L(tr, "Tuş desteğini aç", "Enable buttons")} action={telegramEnableButtons} />
                </div>
              ) : null}
              {it.name.startsWith("Gmail") ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-medium">{L(tr, "Apps Script kodu", "Apps Script code")}</summary>
                  <div className="mt-2 space-y-2">
                    <CopyButton text={GMAIL_BRIDGE_SCRIPT} label={L(tr, "Kodu kopyala", "Copy code")} />
                    <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-3 text-xs">{GMAIL_BRIDGE_SCRIPT}</pre>
                  </div>
                </details>
              ) : null}
            </li>
          );
        })}
      </ul>

      <h2 className="mt-10 mb-1 text-lg font-semibold tracking-tight">{L(tr, "Fiş okuma sağlayıcısı", "Receipt reading provider")}</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        {L(tr, "Telegram'a gelen fişleri hangi yapay zekanın okuyacağı. İkisi de ücretsiz katmanla çalışır; ikisi de tanımlıysa tercih edilen önce denenir, olmazsa diğerine geçilir.", "Which AI reads receipts sent to Telegram. Both work on a free tier; if both are set the preferred one is tried first and the other is the fallback.")}
      </p>
      <ul className="space-y-4">
        {providers.map((p) => (
          <li key={p.id} className="rounded-xl border bg-card p-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-medium">
                {p.ready ? <CheckCircle2 className="size-4 text-emerald-500" aria-hidden /> : <Circle className="size-4 text-muted-foreground" aria-hidden />}
                {p.name}
              </div>
              <div className="flex gap-1.5">
                {active[0] === p.id ? <Badge>{L(tr, "Aktif", "Active")}</Badge> : active.includes(p.id) ? <Badge variant="outline">{L(tr, "Yedek", "Fallback")}</Badge> : null}
                <Badge variant={p.ready ? "secondary" : "outline"}>{p.ready ? L(tr, "Anahtar var", "Key set") : L(tr, "Anahtar yok", "No key")}</Badge>
              </div>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{p.note}</p>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
              {p.steps.map((st) => <li key={st}>{st}</li>)}
            </ol>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-muted p-3 text-xs">{p.env}</pre>
            <div className="mt-3">{p.ready ? <ProviderTest provider={p.id} label={L(tr, "Anahtarı sına", "Test key")} action={testProvider} /> : <p className="text-xs text-muted-foreground">{L(tr, "Anahtarı ekleyip yeniden dağıttıktan sonra burada sınayabilirsin.", "After adding the key and redeploying you can test it here.")}</p>}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}



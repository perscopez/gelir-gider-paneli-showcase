import { revalidatePath } from "next/cache";
import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/i18n";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "Bildirimler" };

async function markAllRead() {
  "use server";
  const supabase = await createClient();
  await supabase.from("notifications").update({ read: true }).eq("read", false);
  revalidatePath("/notifications");
}

export default async function NotificationsPage() {
  const tr = (await getLocale()) === "tr";
  const supabase = await createClient();
  const { data, error } = await supabase.from("notifications").select("id,title,body,read,created_at").order("created_at", { ascending: false }).limit(100);
  const rows = data ?? [];
  const unread = rows.filter((r) => !r.read).length;
  const fmtDate = new Intl.DateTimeFormat(tr ? "tr-TR" : "en-GB", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Istanbul" });
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={tr ? "Bildirimler" : "Notifications"}
        description={tr ? "Telegram'a giden tüm bildirimlerin kaydı: ekstre işlendi, kart son ödeme, bakiye uyarısı, kayıt gelmedi uyarısı." : "A log of everything sent to Telegram: statements, card due dates, balance and missing-data warnings."}
        actions={unread > 0 ? <form action={markAllRead}><Button variant="outline" size="sm" type="submit">{tr ? "Hepsini okundu yap" : "Mark all read"}</Button></form> : undefined}
      />
      {error ? (
        <EmptyState icon={Bell} title={tr ? "Bildirim kutusu kurulu değil" : "Inbox not set up"} description={tr ? "supabase/migrations/0005_notifications.sql dosyasını Supabase SQL Editor'de bir kez çalıştır." : "Run supabase/migrations/0005_notifications.sql once in the Supabase SQL Editor."} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Bell} title={tr ? "Henüz bildirim yok" : "No notifications yet"} />
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <Card key={r.id} className={r.read ? "opacity-70" : undefined}>
              <CardContent className="space-y-1 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{!r.read ? <span className="mr-2 inline-block size-2 rounded-full bg-primary align-middle" aria-hidden /> : null}{r.title}</span>
                  <time className="shrink-0 text-xs text-muted-foreground">{fmtDate.format(new Date(r.created_at))}</time>
                </div>
                <p className="whitespace-pre-line text-muted-foreground">{r.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

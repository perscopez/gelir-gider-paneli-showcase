import type { ReactNode } from "react";
import { LogOut, Wallet } from "lucide-react";
import { getLocale, t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { createClient, isDemo } from "@/lib/supabase/server";
import { NavLinks, type NavItem } from "./nav-links";
import { MobileNav } from "./mobile-nav";
import { ThemeToggle } from "./theme-toggle";
import { setDemo, setLocale, signOut } from "./actions";
import { TourButton } from "./tour";
import { CommandPalette } from "./command-palette";
import { FlaskConical } from "lucide-react";

export async function AppShell({ children, quickAdd }: { children: ReactNode; quickAdd: ReactNode }) {
  const locale = await getLocale();
  const L = t(locale);
  const { data } = await (await createClient()).auth.getUser();
  const demo = await isDemo();
  const tr = locale === "tr";
  const items: NavItem[] = [
    { href: "/", label: L.dashboard }, { href: "/transactions", label: L.transactions }, { href: "/accounts", label: L.accounts },
    { href: "/budgets", label: L.budgets }, { href: "/groceries", label: tr ? "Market" : "Groceries" }, { href: "/deals", label: tr ? "Fırsatlar" : "Deals" }, { href: "/goals", label: L.goals }, { href: "/recurring", label: L.recurring }, { href: "/notifications", label: tr ? "Bildirimler" : "Notifications" },
    { href: "/rules", label: L.rules }, { href: "/import", label: L.importNav }, { href: "/integrations", label: L.integrations }, { href: "/settings", label: L.settings },
  ];
  const brand = (
    <div className="flex items-center gap-2.5 px-3 py-1">
      <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Wallet className="size-4" aria-hidden /></div>
      <span className="text-sm font-semibold tracking-tight">{L.appName}</span>
    </div>
  );
  const other = locale === "tr" ? "en" : "tr";
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen flex-col gap-4 border-r bg-sidebar p-3 text-sidebar-foreground lg:flex">
        {brand}
        <div className="flex-1 overflow-y-auto"><NavLinks items={items} /></div>
        <Separator />
        <div className="flex items-center justify-between gap-1 px-1">
          <div className="min-w-0 px-2 text-xs text-muted-foreground"><span className="block truncate">{demo ? "demo@example.com" : data.user?.email}</span></div>
          <form action={signOut}><Button type="submit" variant="ghost" size="icon" aria-label={L.signOut} title={L.signOut}><LogOut className="size-4" /></Button></form>
        </div>
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur supports-backdrop-filter:bg-background/60 lg:px-8">
          <MobileNav items={items} title={L.appName} />
          <span className="text-sm font-semibold lg:hidden">{L.appName}</span>
          <div className="flex-1" />
          <CommandPalette items={items} labels={{ placeholder: tr ? "Sayfa ara veya işlem ara…" : "Go to page or search transactions…", searchFor: tr ? "İşlemlerde ara" : "Search transactions", theme: tr ? "Temayı değiştir" : "Toggle theme", open: tr ? "Komut paleti" : "Command palette", empty: tr ? "Sonuç yok" : "No results" }} />
          <span data-tour="quick-add">{quickAdd}</span>
          <form action={setDemo}>
            <input type="hidden" name="on" value={demo ? "0" : "1"} />
            <Button type="submit" variant={demo ? "secondary" : "ghost"} size="icon" data-tour="demo" aria-pressed={demo}
              aria-label={demo ? (tr ? "Gösterim modunu kapat" : "Exit demo mode") : (tr ? "Gösterim modu" : "Demo mode")}
              title={demo ? (tr ? "Gösterim modunu kapat" : "Exit demo mode") : (tr ? "Gösterim modu (uydurma sayılar)" : "Demo mode (made-up numbers)")}>
              <FlaskConical className="size-4" />
            </Button>
          </form>
          <TourButton locale={locale} labels={{ start: tr ? "Tanıtım turu" : "Guided tour", next: tr ? "İleri" : "Next", prev: tr ? "Geri" : "Back", done: tr ? "Bitir" : "Done", close: tr ? "Kapat" : "Close" }} />
          <form action={setLocale}>
            <input type="hidden" name="locale" value={other} />
            <Button type="submit" variant="ghost" size="sm" className="w-9 font-medium uppercase" aria-label={L.language} title={L.language}>{other}</Button>
          </form>
          <ThemeToggle labels={{ light: L.themeLight, dark: L.themeDark, system: L.themeSystem, theme: L.theme }} />
        </header>
        {demo ? (
          <div className="flex items-center justify-center gap-2 bg-amber-500/15 px-4 py-1.5 text-xs font-medium text-amber-900 dark:text-amber-200" role="status">
            <FlaskConical className="size-3.5" aria-hidden />
            {tr ? "Gösterim modu: örnek veriler, hiçbir şey kaydedilmez." : "Demo mode: sample data, nothing is saved."}
          </div>
        ) : null}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}

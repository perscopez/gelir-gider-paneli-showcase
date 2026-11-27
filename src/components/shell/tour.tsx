"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { driver, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import { Button } from "@/components/ui/button";
import { Compass } from "lucide-react";

type Step = { path: string; target?: string; tr: [string, string]; en: [string, string] };

// Her adım bir sayfaya gider ve oradaki bir öğeyi (data-tour) vurgular; öğe yoksa (ör. mobil menü kapalıyken) ortada gösterilir.
const STEPS: Step[] = [
  { path: "/", tr: ["Hoş geldin", "Bu kısa tur panelin her bölümünü gösterir. İstediğin an kapatabilirsin."], en: ["Welcome", "This short tour walks through every part of the panel. Close it any time."] },
  { path: "/", target: "[data-tour=summary]", tr: ["Genel bakış", "Harcanabilir para, bu ayın geliri, gideri ve neti. Her tutar EUR ve TL olarak görünür."], en: ["Overview", "Spendable money, this month's income, expenses and net. Every amount shows in EUR and TRY."] },
  { path: "/", target: "[data-tour=quick-add]", tr: ["Hızlı ekle", "Her sayfadan yeni gelir, gider veya transfer ekleyebilirsin."], en: ["Quick add", "Add income, an expense or a transfer from any page."] },
  { path: "/transactions", target: "[data-tour-nav='/transactions']", tr: ["İşlemler", "Arama, ay/tür/hesap/kategori filtreleri, düzenleme, silme ve CSV dışa aktarma burada."], en: ["Transactions", "Search, filter by month/type/account/category, edit, delete and export CSV."] },
  { path: "/accounts", target: "[data-tour-nav='/accounts']", tr: ["Hesaplar", "Banka, nakit, kredi kartı ve bloke hesaplarını ve bakiyelerini yönet."], en: ["Accounts", "Manage bank, cash, credit card and blocked accounts and their balances."] },
  { path: "/budgets", target: "[data-tour-nav='/budgets']", tr: ["Bütçeler", "Kategori başına aylık limit koy; harcama limite yaklaşınca renk değişir."], en: ["Budgets", "Set a monthly limit per category; the bar changes colour as you approach it."] },
  { path: "/groceries", target: "[data-tour-nav='/groceries']", tr: ["Market", "Fişlerden okunan kalemlerle aynı ürünün mağazalara göre birim fiyatı ve kategori harcaması. İpucu: Ctrl/⌘+K ile her yere hızlıca git."], en: ["Groceries", "Unit prices of the same product across stores plus category spend, from receipt items. Tip: Ctrl/⌘+K jumps anywhere."] },
  { path: "/goals", target: "[data-tour-nav='/goals']", tr: ["Hedefler", "Birikim hedeflerini ve aylık ne kadar ayırman gerektiğini takip et."], en: ["Goals", "Track savings goals and how much to set aside each month."] },
  { path: "/recurring", target: "[data-tour-nav='/recurring']", tr: ["Tekrarlayanlar", "Kira, abonelik, maaş gibi düzenli işlemleri otomatik işle veya hatırlat."], en: ["Recurring", "Create or just remind yourself of rent, subscriptions, salary and similar."] },
  { path: "/rules", target: "[data-tour-nav='/rules']", tr: ["Kurallar", "Açıklamada geçen kelimeye göre kategoriyi otomatik ata."], en: ["Rules", "Auto-assign a category based on a word in the description."] },
  { path: "/import", target: "[data-tour-nav='/import']", tr: ["İçe aktar", "Banka ekstresi PDF'ini yükle; doğrulanır, kategorilenir, tekrarlar atlanır."], en: ["Import", "Upload a bank statement PDF; it is verified, categorised and duplicates skipped."] },
  { path: "/integrations", target: "[data-tour-nav='/integrations']", tr: ["Bağlantılar", "Telegram, Apple Pay, Gmail köprüsü, fiş okuma: hangisi hazır, son ne zaman çalıştı."], en: ["Integrations", "Telegram, Apple Pay, Gmail bridge, receipt OCR: what's ready and when it last ran."] },
  { path: "/settings", target: "[data-tour-nav='/settings']", tr: ["Ayarlar", "Dil, kategori yönetimi, CSV dışa aktarma ve çıkış."], en: ["Settings", "Language, category management, CSV export and sign out."] },
  { path: "/", target: "[data-tour=demo]", tr: ["Gösterim modu", "Başkalarına gösterirken bunu aç: uydurma sayılar görünür, gerçek verin hiç okunmaz."], en: ["Demo mode", "Turn this on when showing others: made-up numbers appear and your real data is never read."] },
];

const visible = (el: Element | null): el is HTMLElement => !!el && (el as HTMLElement).offsetParent !== null;

export function TourButton({ locale, labels }: { locale: "tr" | "en"; labels: { start: string; next: string; prev: string; done: string; close: string } }) {
  const router = useRouter();
  const pathname = usePathname();
  const drv = useRef<Driver | null>(null);
  const idx = useRef(0);
  const pendingPath = useRef<string | null>(null);
  const showRef = useRef<(i: number) => void>(() => {});

  const stop = useCallback(() => { drv.current?.destroy(); drv.current = null; }, []);

  const show = useCallback((i: number) => {
    stop();
    const step = STEPS[i];
    if (!step) return;
    idx.current = i;
    const render = () => {
      const el = step.target ? document.querySelector(step.target) : null;
      const [title, description] = step[locale];
      const d = driver({
        showProgress: true, progressText: `{{current}} / {{total}}`.replace("{{total}}", String(STEPS.length)).replace("{{current}}", String(i + 1)),
        nextBtnText: labels.next, prevBtnText: labels.prev, doneBtnText: labels.done,
        showButtons: ["next", "previous", "close"], allowClose: true, overlayOpacity: 0.55,
        steps: [{ element: visible(el) ? el : undefined, popover: { title, description, showButtons: ["next", ...(i > 0 ? (["previous"] as const) : []), "close"] } }],
        onNextClick: () => { if (i + 1 >= STEPS.length) stop(); else go(i + 1); },
        onPrevClick: () => go(i - 1),
        onCloseClick: () => stop(),
      });
      drv.current = d;
      d.drive();
    };
    const go = (to: number) => {
      stop();
      const next = STEPS[to];
      if (next.path !== window.location.pathname) { pendingPath.current = next.path; router.push(next.path); idx.current = to; }
      else showRef.current(to);
    };
    render();
  }, [locale, labels, router, stop]);
  useEffect(() => { showRef.current = show; }, [show]);

  // Sayfa değişince bekleyen adım gösterilir (içerik oturduktan kısa süre sonra).
  useEffect(() => {
    if (pendingPath.current && pendingPath.current === pathname) {
      pendingPath.current = null;
      const t = setTimeout(() => showRef.current(idx.current), 350);
      return () => clearTimeout(t);
    }
  }, [pathname]);
  useEffect(() => stop, [stop]);

  return (
    <Button
      variant="ghost" size="icon" aria-label={labels.start} title={labels.start} data-tour="tour"
      onClick={() => {
        if (window.location.pathname !== "/") { pendingPath.current = "/"; idx.current = 0; router.push("/"); }
        else showRef.current(0);
      }}
    >
      <Compass className="size-4" />
    </Button>
  );
}

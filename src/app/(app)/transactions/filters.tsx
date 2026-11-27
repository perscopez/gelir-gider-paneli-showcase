"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { inputCls } from "@/components/field";

type Opt = { id: string; label: string };

function shiftMonth(key: string, n: number) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

// Filtreler URL'de tutulur: paylaşılabilir/yenilemeye dayanıklı. Arama yazarken 350 ms sonra uygulanır.
export function TransactionFilters({
  month, accounts, categories, labels, locale,
}: {
  month: string;
  accounts: Opt[];
  categories: Opt[];
  locale: string;
  labels: { search: string; all: string; account: string; category: string; kind: string; income: string; expense: string; transfer: string; uncategorized: string; allMonths: string; clear: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function set(patch: Record<string, string | null>) {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    p.delete("page");
    start(() => router.replace(`${pathname}?${p.toString()}`));
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  const monthLabel = month
    ? new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`))
    : labels.allMonths;
  const active = !!(sp.get("q") || sp.get("account") || sp.get("category") || sp.get("kind") || sp.get("month"));

  return (
    <div className="space-y-3" aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-lg border bg-background">
          <Button variant="ghost" size="icon" aria-label="‹" disabled={!month} onClick={() => set({ month: shiftMonth(month, -1) })}><ChevronLeft className="size-4" /></Button>
          <button type="button" className="min-w-36 px-2 text-center text-sm font-medium capitalize" onClick={() => set({ month: month ? "all" : null })}>{monthLabel}</button>
          <Button variant="ghost" size="icon" aria-label="›" disabled={!month} onClick={() => set({ month: shiftMonth(month, 1) })}><ChevronRight className="size-4" /></Button>
        </div>
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              clearTimeout(timer.current);
              const v = e.target.value;
              timer.current = setTimeout(() => set({ q: v.trim() || null }), 350);
            }}
            placeholder={labels.search}
            aria-label={labels.search}
            className={`${inputCls} pl-9`}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label={labels.account} className={`${inputCls} !w-auto min-w-36`} value={sp.get("account") ?? ""} onChange={(e) => set({ account: e.target.value || null })}>
          <option value="">{labels.account}: {labels.all}</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
        <select aria-label={labels.category} className={`${inputCls} !w-auto min-w-36`} value={sp.get("category") ?? ""} onChange={(e) => set({ category: e.target.value || null })}>
          <option value="">{labels.category}: {labels.all}</option>
          <option value="none">{labels.uncategorized}</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <select aria-label={labels.kind} className={`${inputCls} !w-auto min-w-32`} value={sp.get("kind") ?? ""} onChange={(e) => set({ kind: e.target.value || null })}>
          <option value="">{labels.kind}: {labels.all}</option>
          <option value="expense">{labels.expense}</option>
          <option value="income">{labels.income}</option>
          <option value="transfer">{labels.transfer}</option>
        </select>
        {active && (
          <Button variant="ghost" size="sm" onClick={() => { setQ(""); start(() => router.replace(pathname)); }}><X className="size-4" />{labels.clear}</Button>
        )}
      </div>
    </div>
  );
}

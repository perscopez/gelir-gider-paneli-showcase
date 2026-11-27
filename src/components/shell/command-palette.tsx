"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Moon, Search, Sun } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Cmd = { id: string; label: string; run: () => void };

// Ctrl/⌘+K: sayfalara git, temayı değiştir ya da yazdığını işlemlerde ara.
export function CommandPalette({ items, labels }: { items: { href: string; label: string }[]; labels: { placeholder: string; searchFor: string; theme: string; open: string; empty: string } }) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const cmds = useMemo<Cmd[]>(() => {
    const needle = q.trim().toLowerCase();
    const nav = items.filter((i) => !needle || i.label.toLowerCase().includes(needle)).map((i) => ({ id: i.href, label: i.label, run: () => router.push(i.href) }));
    const extra: Cmd[] = [];
    if (!needle || labels.theme.toLowerCase().includes(needle)) extra.push({ id: "theme", label: labels.theme, run: () => setTheme(resolvedTheme === "dark" ? "light" : "dark") });
    if (needle) extra.unshift({ id: "search", label: `${labels.searchFor}: “${q.trim()}”`, run: () => router.push(`/transactions?month=all&q=${encodeURIComponent(q.trim())}`) });
    return [...nav, ...extra.filter((c) => c.id === "search"), ...extra.filter((c) => c.id !== "search")];
  }, [q, items, labels, router, setTheme, resolvedTheme]);

  const pick = (c?: Cmd) => { if (!c) return; setOpen(false); setQ(""); setActive(0); c.run(); };

  return (
    <>
      <Button variant="ghost" size="icon" aria-label={labels.open} title={`${labels.open} (Ctrl/⌘+K)`} onClick={() => setOpen(true)}><Search className="size-4" /></Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setQ(""); setActive(0); } }}>
        <DialogContent className="top-[20%] translate-y-0 gap-0 p-0 sm:max-w-md" showCloseButton={false}>
          <DialogTitle className="sr-only">{labels.open}</DialogTitle>
          <DialogDescription className="sr-only">{labels.placeholder}</DialogDescription>
          <input
            autoFocus value={q} placeholder={labels.placeholder} aria-label={labels.placeholder}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, cmds.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); pick(cmds[active]); }
            }}
            className="h-12 w-full rounded-t-xl border-b bg-transparent px-4 text-sm outline-none placeholder:text-muted-foreground"
          />
          <ul className="max-h-72 overflow-y-auto p-1.5" role="listbox">
            {!cmds.length ? <li className="px-3 py-6 text-center text-sm text-muted-foreground">{labels.empty}</li> : null}
            {cmds.map((c, i) => (
              <li key={c.id} role="option" aria-selected={i === active}>
                <button type="button" onMouseEnter={() => setActive(i)} onClick={() => pick(c)}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${i === active ? "bg-accent text-accent-foreground" : ""}`}>
                  {c.id === "theme" ? (resolvedTheme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />) : c.id === "search" ? <Search className="size-4" /> : null}
                  {c.label}
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}

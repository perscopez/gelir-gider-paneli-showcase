"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { bulkDelete, bulkMoveAccount, bulkSetCategory, type BulkResult } from "./actions";

type Opt = { id: string; label: string };

// Satırlardaki `input[data-bulk]` kutularını okur: seçili sayısı, hepsini seç, kategori/hesap değiştir, sil.
export function BulkBar({ categories, accounts, tr }: { categories: Opt[]; accounts: Opt[]; tr: boolean }) {
  const router = useRouter();
  const [ids, setIds] = useState<string[]>([]);
  const [cat, setCat] = useState("");
  const [acc, setAcc] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const read = () => Array.from(document.querySelectorAll<HTMLInputElement>("input[data-bulk]:checked")).map((i) => i.value);

  useEffect(() => {
    const h = (e: Event) => { if ((e.target as HTMLElement | null)?.matches?.("input[data-bulk]")) setIds(read()); };
    document.addEventListener("change", h);
    return () => document.removeEventListener("change", h);
  }, []);

  const setAll = (checked: boolean) => {
    document.querySelectorAll<HTMLInputElement>("input[data-bulk]").forEach((i) => { i.checked = checked; });
    setIds(read());
  };
  const exec = (fn: (fd: FormData) => Promise<BulkResult>, extra: Record<string, string> = {}) =>
    start(async () => {
      const fd = new FormData();
      fd.set("ids", JSON.stringify(ids));
      for (const [k, v] of Object.entries(extra)) fd.set(k, v);
      const r = await fn(fd);
      (r.ok ? toast.success : toast.error)(r.message);
      if (r.ok) { setAll(false); setConfirm(false); router.refresh(); }
    });

  const sel = "h-8 rounded-lg border bg-background px-2 text-xs";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-muted/40 px-4 py-2 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" className="size-4" aria-label={tr ? "Sayfadakilerin hepsini seç" : "Select all on page"} checked={false}
          onChange={(e) => setAll(e.target.checked)} ref={(el) => { if (el) el.checked = false; }} />
        <span className="text-muted-foreground">{ids.length ? `${ids.length} ${tr ? "seçili" : "selected"}` : tr ? "Toplu düzenle: işlemleri seç" : "Bulk edit: select transactions"}</span>
      </label>
      {ids.length ? (
        <>
          <span className="flex items-center gap-1.5">
            <select value={cat} onChange={(e) => setCat(e.target.value)} className={sel} aria-label={tr ? "Kategori" : "Category"}>
              <option value="">{tr ? "Kategori: (boş = kaldır)" : "Category: (empty = clear)"}</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => exec(bulkSetCategory, { category_id: cat })}>{tr ? "Kategoriyi uygula" : "Apply category"}</Button>
          </span>
          <span className="flex items-center gap-1.5">
            <select value={acc} onChange={(e) => setAcc(e.target.value)} className={sel} aria-label={tr ? "Hesap" : "Account"}>
              <option value="">{tr ? "Hesap seç…" : "Choose account…"}</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
            <Button size="sm" variant="outline" disabled={pending || !acc} onClick={() => exec(bulkMoveAccount, { account_id: acc })}>{tr ? "Hesaba taşı" : "Move"}</Button>
          </span>
          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={pending} onClick={() => setConfirm(true)}><Trash2 className="size-4" />{tr ? "Sil" : "Delete"}</Button>
          <Button size="sm" variant="ghost" onClick={() => setAll(false)}>{tr ? "Seçimi temizle" : "Clear"}</Button>
        </>
      ) : null}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr ? `${ids.length} işlem silinsin mi?` : `Delete ${ids.length} transactions?`}</AlertDialogTitle>
            <AlertDialogDescription>{tr ? "Bu işlem geri alınamaz. Seçilen kayıtlar ve varsa fiş kalemleri silinir." : "This cannot be undone."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr ? "İptal" : "Cancel"}</AlertDialogCancel>
            <Button variant="destructive" disabled={pending} onClick={() => exec(bulkDelete)}>{tr ? "Sil" : "Delete"}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { CheckCircle2, FileUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, inputCls } from "@/components/field";
import { commitStatement, previewStatement } from "./actions";
import type { PreviewData } from "./types";

type Account = { id: string; name: string; currency: string; type: string };
type Category = { id: string; name_tr: string; name_en: string; kind: "income" | "expense" };

const T = {
  tr: {
    account: "Hangi hesabın ekstresi?", file: "Ekstre (PDF)", fileHint: "Fabrikam uygulamasından indirdiğin Contoso Bank hesap ekstresi",
    read: "Ekstreyi oku", reading: "Okunuyor…", verified: "Ekstre doğrulandı: işlem sayısı, toplamlar ve bakiye zinciri tutuyor",
    period: "Dönem", rows: "işlem", start: "Başlangıç bakiyesi", end: "Son bakiye", blockedTransfer: "Fabrikam ödemesini bloke hesaptan transfer olarak işle",
    dup: "Zaten içe aktarılmış", maybe: "Muhtemelen zaten girilmiş", import: "içe aktar", importing: "Aktarılıyor…", done: "içe aktarıldı",
    skipped: "atlandı", goTx: "İşlemlere git", another: "Başka ekstre", noCat: "Kategori", expectedOk: "Bakiye ekstreyle uyuşuyor",
    expectedBad: "İçe aktarma sonrası hesap bakiyesi ekstreden farklı olur. Hesabın açılış bakiyesini şuna ayarla:", balanceAfter: "İçe aktarma sonrası bakiye", asOfLabel: "ekstre tarihi itibarıyla", source: "Kredi kartı ödemeleri hangi hesaptan çıktı?", sourceHint: "Karta yapılan ödeme bu hesaptan karta transfer olarak yazılır", payment: "Kart ödemesi", paymentTo: "kaynak", cardInfo: "Kart", limitL: "Limit", dueL: "Son ödeme", minL: "Asgari", debtL: "Dönem borcu", noBalance: "Bu ekstre bakiye içermez: yalnızca toplam alışveriş tutarı doğrulandı",
    noAccounts: "Önce bu para biriminde bir hesap ekle.", accountsLink: "Hesaplar'a git",
  },
  en: {
    account: "Statement of which account?", file: "Statement (PDF)", fileHint: "The Contoso Bank account statement downloaded from the Fabrikam app",
    read: "Read statement", reading: "Reading…", verified: "Statement verified: transaction count, totals and balance chain match",
    period: "Period", rows: "transactions", start: "Starting balance", end: "Final balance", blockedTransfer: "Record the Fabrikam payout as a transfer from the blocked account",
    dup: "Already imported", maybe: "Probably already entered", import: "import", importing: "Importing…", done: "imported",
    skipped: "skipped", goTx: "Go to transactions", another: "Another statement", noCat: "Category", expectedOk: "Balance matches the statement",
    expectedBad: "After import the account balance will differ from the statement. Set the account's opening balance to:", balanceAfter: "Balance after import", asOfLabel: "as of statement date", source: "Which account were the card payments made from?", sourceHint: "Card payments are recorded as a transfer from this account to the card", payment: "Card payment", paymentTo: "from", cardInfo: "Card", limitL: "Limit", dueL: "Due", minL: "Minimum", debtL: "Statement debt", noBalance: "This statement has no balance: only the total purchases were verified",
    noAccounts: "Add an account in this currency first.", accountsLink: "Go to Accounts",
  },
} as const;

const fmtMoney = (n: number, cur: string, locale: string) =>
  new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-GB", { style: "currency", currency: cur }).format(n);

export function ImportWizard({ accounts, categories, locale }: { accounts: Account[]; categories: Category[]; locale: "tr" | "en" }) {
  const L = T[locale];
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const selected0 = accounts.find((a) => a.id === accountId);
  const isCardAccount = selected0?.type === "credit_card";
  // Kart ödemelerinin çıktığı hesap: kredi kartı olmayan, aynı para biriminde; adı "anka" içeren öncelikli
  const sources = accounts.filter((a) => a.type !== "credit_card" && a.type !== "blocked" && a.type !== "reserve" && a.currency === selected0?.currency);
  const [sourceId, setSourceId] = useState("");
  const effectiveSource = sourceId || (sources.find((a) => /vak[ıi]f/i.test(a.name))?.id ?? sources[0]?.id ?? "");
  const [data, setData] = useState<PreviewData | null>(null);
  const [include, setInclude] = useState<Record<number, boolean>>({});
  const [cats, setCats] = useState<Record<number, string>>({});
  const [blockedTransfer, setBlockedTransfer] = useState(true);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);
  const fileRef = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => { setData(null); setResult(null); setError(null); fileRef.current = null; if (inputRef.current) inputRef.current.value = ""; };

  function read() {
    const file = fileRef.current ?? inputRef.current?.files?.[0] ?? null;
    if (!file) { setError("PDF dosyası seç."); return; }
    fileRef.current = file;
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("account_id", accountId);
    if (isCardAccount && effectiveSource) fd.set("source_account_id", effectiveSource);
    start(async () => {
      const r = await previewStatement(fd);
      if (!r.ok) { setError(r.error); return; }
      setData(r.data);
      setInclude(Object.fromEntries(r.data.rows.map((x) => [x.idx, x.status === "new"])));
      setCats(Object.fromEntries(r.data.rows.map((x) => [x.idx, x.categoryId ?? ""])));
    });
  }

  function commit() {
    if (!data || !fileRef.current) return;
    const selection = Object.fromEntries(data.rows.map((r) => [
      r.idx, { include: !!include[r.idx] && r.status !== "duplicate", categoryId: cats[r.idx] || null, asBlockedTransfer: blockedTransfer && r.fromBlocked },
    ]));
    const fd = new FormData();
    fd.set("file", fileRef.current);
    fd.set("account_id", accountId);
    if (isCardAccount && effectiveSource) fd.set("source_account_id", effectiveSource);
    fd.set("selection", JSON.stringify(selection));
    setError(null);
    start(async () => {
      const r = await commitStatement(fd);
      if (!r.ok) { setError(r.error); return; }
      setResult({ imported: r.imported, skipped: r.skipped });
    });
  }

  const selected = useMemo(() => (data ? data.rows.filter((r) => include[r.idx] && r.status !== "duplicate") : []), [data, include]);
  const after = data ? data.accountBalance + selected.reduce((a, r) => a + r.amount, 0) : 0;
  const diff = data ? Math.round((data.finalBalance - after) * 100) / 100 : 0;
  const hasBlockedRows = !!data?.blockedAccountName && data.rows.some((r) => r.fromBlocked);

  if (!accounts.length) {
    return <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">{L.noAccounts} <Link href="/accounts" className="underline">{L.accountsLink}</Link></p>;
  }

  if (result) {
    return (
      <div className="space-y-3 rounded-xl border bg-card p-6 text-sm shadow-xs">
        <p className="flex items-center gap-2 text-base font-medium text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="size-5" />{result.imported} {L.rows} {L.done}{result.skipped ? `, ${result.skipped} ${L.skipped}` : ""}</p>
        <div className="flex gap-3">
          <Link href="/transactions" className="underline">{L.goTx}</Link>
          <button onClick={reset} className="text-muted-foreground underline">{L.another}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 rounded-xl border bg-card p-5 shadow-xs sm:grid-cols-3">
        <Field label={L.account}>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputCls} disabled={!!data}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
          </select>
        </Field>
        <Field label={L.file} hint={L.fileHint} className="sm:col-span-2">
          <input ref={inputRef} type="file" accept="application/pdf" className="block w-full cursor-pointer rounded-lg border border-dashed bg-muted/30 px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1 file:text-xs file:font-medium file:text-primary-foreground" disabled={!!data}
            onChange={(e) => { fileRef.current = e.target.files?.[0] ?? null; }} />
        </Field>
        {isCardAccount && !data ? (
          <Field label={L.source} hint={L.sourceHint} className="sm:col-span-3">
            <select value={effectiveSource} onChange={(e) => setSourceId(e.target.value)} className={inputCls}>
              {sources.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
            </select>
          </Field>
        ) : null}
        {!data && (
          <div className="col-span-full flex items-center gap-3">
            <Button onClick={read} disabled={pending}>{pending ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}{pending ? L.reading : L.read}</Button>
            {error && <span className="text-sm text-destructive" role="alert">{error}</span>}
          </div>
        )}
      </div>

      {data && (
        <>
          <div className="space-y-2 rounded-xl border bg-card p-5 text-sm shadow-xs">
            <p className="flex items-center gap-2 font-medium text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="size-4" />{L.verified}</p>
            <p className="text-muted-foreground">
              {L.period}: {data.periodFrom} → {data.periodTo} · {data.rows.length} {L.rows} · {L.start}: {fmtMoney(data.startingBalance, data.currency, locale)} · {L.end}: {fmtMoney(data.finalBalance, data.currency, locale)}
            </p>
            {data.card ? (
              <p className="text-muted-foreground">
                {L.cardInfo} ····{data.card.last4} · {L.debtL}: {fmtMoney(data.card.debt, data.currency, locale)}{data.card.minPayment ? ` · ${L.minL}: ${fmtMoney(data.card.minPayment, data.currency, locale)}` : ""}{data.card.dueDate ? ` · ${L.dueL}: ${data.card.dueDate}` : ""}{data.card.limit ? ` · ${L.limitL}: ${fmtMoney(data.card.limit, data.currency, locale)}` : ""}
              </p>
            ) : null}
            {!data.balanceKnown ? <p className="text-muted-foreground">{L.noBalance}</p> : <p className={diff === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600"}>
              {L.balanceAfter} ({L.asOfLabel}, {data.asOf}): {fmtMoney(after, data.currency, locale)} — {diff === 0 ? `✓ ${L.expectedOk}` : `${L.expectedBad} ${fmtMoney(data.accountOpening + diff, data.currency, locale)}`}
            </p>}
            {hasBlockedRows && (
              <label className="flex items-center gap-2">
                <Checkbox checked={blockedTransfer} onCheckedChange={(v) => setBlockedTransfer(!!v)} /> {L.blockedTransfer} ({data.blockedAccountName})
              </label>
            )}
          </div>

          <ul className="divide-y rounded-xl border bg-card shadow-xs">
            {data.rows.map((r) => {
              const options = categories.filter((c) => c.kind === (r.amount < 0 ? "expense" : "income"));
              const isPay = !!r.isPayment;
              const disabled = r.status === "duplicate";
              return (
                <li key={r.idx} className={`flex flex-wrap items-center gap-3 p-3 text-sm ${disabled ? "opacity-50" : ""}`}>
                  <Checkbox checked={!!include[r.idx] && !disabled} disabled={disabled} aria-label={r.merchant}
                    onCheckedChange={(v) => setInclude((s) => ({ ...s, [r.idx]: !!v }))} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{r.merchant}{isPay ? <Badge variant="secondary" className="ml-2">{L.payment}{data.paymentSource ? ` · ${L.paymentTo}: ${data.paymentSource}` : ""}</Badge> : null}</div>
                    <div className="truncate text-xs text-muted-foreground">{r.date}{r.note ? ` · ${r.note}` : ""}</div>
                    {r.status === "duplicate" && <Badge variant="outline" className="mt-1">{L.dup}</Badge>}
                    {r.status === "maybe" && <div className="text-xs text-amber-600">{L.maybe}: {r.matchedWith}</div>}
                  </div>
                  <select value={cats[r.idx] ?? ""} onChange={(e) => setCats((s) => ({ ...s, [r.idx]: e.target.value }))}
                    className="h-9 w-44 rounded-lg border bg-background px-2 text-xs" disabled={disabled || isPay || (r.fromBlocked && blockedTransfer)} aria-label={L.noCat}>
                    <option value="">{L.noCat}</option>
                    {options.map((c) => <option key={c.id} value={c.id}>{locale === "tr" ? c.name_tr : c.name_en}</option>)}
                  </select>
                  <span className={`w-24 text-right font-medium tabular-nums ${r.amount > 0 ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{fmtMoney(r.amount, data.currency, locale)}</span>
                </li>
              );
            })}
          </ul>

          <div className="flex items-center gap-3">
            <Button onClick={commit} disabled={pending || !selected.length}>{pending ? L.importing : `${selected.length} ${L.rows} ${L.import}`}</Button>
            <button onClick={reset} className="text-sm text-muted-foreground underline" disabled={pending}>{L.another}</button>
            {error && <span className="text-sm text-destructive" role="alert">{error}</span>}
          </div>
        </>
      )}
    </div>
  );
}

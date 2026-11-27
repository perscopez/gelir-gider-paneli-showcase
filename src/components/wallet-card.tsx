import { ArrowDownLeft, ArrowUpRight, Gauge, Lock, PiggyBank, Scale, Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type WalletData = {
  cur: "EUR" | "TRY"; title: string; spendable: string; approx?: string; blocked?: string; reserve?: string;
  inc: string; incHint?: string; exp: string; net: string; netPositive: boolean;
  deltaInc?: string; deltaExp?: string;
  allowance: { ok: boolean; perDay: string; text: string };
  labels: { spendable: string; income: string; expense: string; net: string; perDay: string; blocked: string; reserve: string; allowance: string };
};

// Tek para biriminin cüzdanı: bakiye, bu ayın geliri/gideri/neti ve günlük harcama payı. Başka para birimiyle toplanmaz.
export function WalletCard({ w }: { w: WalletData }) {
  const L = w.labels;
  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-medium"><span className="flex size-8 items-center justify-center rounded-lg bg-muted"><Wallet className="size-4" aria-hidden /></span>{w.title}</div>
          <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{w.cur === "EUR" ? "€ EUR" : "₺ TRY"}</span>
        </div>

        <div>
          <div className="text-sm text-muted-foreground">{L.spendable}</div>
          <div className="tnum text-3xl font-semibold tracking-tight">{w.spendable}</div>
          {w.approx ? <div className="tnum text-xs text-muted-foreground">≈ {w.approx}</div> : null}
          {w.reserve ? <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"><PiggyBank className="size-3" aria-hidden />{L.reserve}: {w.reserve}</div> : null}
          {w.blocked ? <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"><Lock className="size-3" aria-hidden />{L.blocked}: {w.blocked}</div> : null}
        </div>

        <dl className="grid grid-cols-3 gap-3 border-t pt-3 text-sm">
          <div>
            <dt className="flex items-center gap-1 text-xs text-muted-foreground"><ArrowDownLeft className="size-3" aria-hidden />{L.income}</dt>
            <dd className="tnum font-semibold text-positive">{w.inc}</dd>
            {w.incHint ? <div className="text-[11px] leading-tight text-muted-foreground">{w.incHint}</div> : null}
            {w.deltaInc ? <div className="text-[11px] leading-tight text-muted-foreground">{w.deltaInc}</div> : null}
          </div>
          <div>
            <dt className="flex items-center gap-1 text-xs text-muted-foreground"><ArrowUpRight className="size-3" aria-hidden />{L.expense}</dt>
            <dd className="tnum font-semibold text-negative">{w.exp}</dd>
            {w.deltaExp ? <div className="text-[11px] leading-tight text-muted-foreground">{w.deltaExp}</div> : null}
          </div>
          <div>
            <dt className="flex items-center gap-1 text-xs text-muted-foreground"><Scale className="size-3" aria-hidden />{L.net}</dt>
            <dd className={cn("tnum font-semibold", w.netPositive ? "text-positive" : "text-negative")}>{w.net}</dd>
          </div>
        </dl>

        <div className={cn("rounded-lg border p-3", w.allowance.ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5")}>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Gauge className="size-3.5" aria-hidden />{L.allowance}</div>
          <div className={cn("tnum text-xl font-semibold", !w.allowance.ok && "text-destructive")}>{w.allowance.perDay} <span className="text-sm font-normal text-muted-foreground">/ {L.perDay}</span></div>
          <div className="mt-0.5 text-xs text-muted-foreground">{w.allowance.text}</div>
        </div>
      </CardContent>
    </Card>
  );
}

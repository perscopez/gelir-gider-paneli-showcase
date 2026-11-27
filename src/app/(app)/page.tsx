import Link from "next/link";
import { CalendarClock, CreditCard, Lock, Wallet } from "lucide-react";
import { addMonthsKey, dueDateISO, monthKey, todayISO } from "@/lib/date";
import { fetchAll } from "@/lib/paginate";
import { activeBudgets, budgetAlertPct, budgetLimitEur, goalProgress } from "@/lib/customize";
import { dailyAllowance, remainingFixedByCurrency, summarize, totalsByCurrency, upcomingRules, walletBalances, type TxnRow } from "@/lib/dashboard";
import { createClient } from "@/lib/supabase/server";
import { getLocale, t } from "@/lib/i18n";
import { accountsWithBalance, currentRate } from "@/lib/data";
import { fmt, toEur, toTry, type Currency } from "@/lib/money";
import { PageHeader } from "@/components/page-header";
import { WalletCard, type WalletData } from "@/components/wallet-card";
import { EmptyState } from "@/components/empty-state";
import { AccountIcon } from "@/components/account-icon";
import { CategoryIcon } from "@/components/category-icon";
import { CashflowChart } from "@/components/charts/cashflow-chart";
import { CategoryDonut } from "@/components/charts/category-donut";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const metadata = { title: "Panel" };

type Cat = { name_tr: string; name_en: string } | null;

function pctDelta(cur: number, prev: number) {
  if (!prev) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

export default async function Dashboard() {
  const locale = await getLocale();
  const L = t(locale);
  const supabase = await createClient();
  const rate = await currentRate();
  const accounts = await accountsWithBalance();
  const today = todayISO();
  const currentKey = monthKey();
  const prevKey = addMonthsKey(currentKey, -1);
  const sixStart = `${addMonthsKey(currentKey, -5)}-01`;

  const [six, { data: recent }, { data: budgets }, { data: goals }, { data: rules }, { count: catCount }] = await Promise.all([
    // Altı aylık tüm satırlar sayfalanarak çekilir (sunucu tek istekte 1.000 satırla sınırlı; aksi halde toplamlar sessizce eksik kalırdı).
    fetchAll<TxnRow>((a, b) => supabase.from("transactions")
      .select("kind,amount,currency,eur_try_rate,occurred_on,category_id,category:categories(name_tr,name_en),account:accounts!transactions_account_id_fkey(type),to_account:accounts!transactions_to_account_id_fkey(type)")
      .gte("occurred_on", sixStart).order("occurred_on").order("id").range(a, b)),
    supabase.from("transactions")
      .select("id,kind,amount,to_amount,currency,occurred_on,merchant,account:accounts!transactions_account_id_fkey(name),to_account:accounts!transactions_to_account_id_fkey(name),category:categories(name_tr,name_en)")
      .order("occurred_on", { ascending: false }).order("created_at", { ascending: false }).limit(7),
    supabase.from("budgets").select("*"),
    supabase.from("goals").select("*").order("created_at").limit(3),
    supabase.from("recurring_rules").select("id,name,kind,amount,currency,day_of_month,active,end_date,start_date,last_run_on").eq("active", true),
    supabase.from("categories").select("id", { count: "exact", head: true }),
  ]);

  // ── Aylık toplamlar (kurallar: src/lib/dashboard.ts) ──
  const sum = summarize(six, currentKey, { locale, uncategorized: L.uncategorized });
  const { exp, byCat, spentById } = sum;

  const inEur = (a: (typeof accounts)[number]) => (rate ? toEur(a.balance, a.currency, rate) : a.currency === "EUR" ? a.balance : 0);
  const worth = accounts.reduce((s, a) => s + inEur(a), 0);
  const blockedTotal = accounts.filter((a) => a.type === "blocked").reduce((s, a) => s + inEur(a), 0);
  const deltaHint = (cur: number, p: number, goodWhenUp: boolean) => {
    const d = pctDelta(cur, p);
    if (d === null) return undefined;
    return `${d >= 0 ? "▲" : "▼"} ${Math.abs(d)}% ${L.vsLastMonth}${(d >= 0) === goodWhenUp ? "" : " ⚠"}`;
  };

  // ── Grafik verisi ──
  const monthFmt = new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", { month: "short", timeZone: "UTC" });
  // Grafikler tüm hesapları tek euro eksenine çevirir (kartlardaki cüzdanlar ayrı kalır).
  const chartData = sum.monthly.map((m) => ({ label: monthFmt.format(new Date(`${m.key}-01T00:00:00Z`)), income: Math.round(m.inc), expense: Math.round(m.exp) }));
  const sorted = [...byCat.entries()].sort((a, b) => b[1].value - a[1].value);
  const palette = ["var(--chart-3)", "var(--chart-1)", "var(--chart-4)", "var(--chart-2)", "var(--chart-5)"];
  const slices = sorted.slice(0, 5).map(([, c], i) => ({ name: c.name, value: Math.round(c.value * 100) / 100, fill: palette[i] }));
  const rest = sorted.slice(5).reduce((a, [, c]) => a + c.value, 0);
  if (rest > 0) slices.push({ name: locale === "tr" ? "Diğer" : "Other", value: Math.round(rest * 100) / 100, fill: "var(--muted-foreground)" });

  // ── Bütçeler, hedefler, yaklaşan ödemeler ──
  const activeB = activeBudgets(budgets ?? [], currentKey);
  const { data: budgetCats } = activeB.length
    ? await supabase.from("categories").select("id,name_tr,name_en").in("id", activeB.map((b) => b.category_id))
    : { data: [] as { id: string; name_tr: string; name_en: string }[] };
  const budgetRows = activeB.map((b) => {
    const c = budgetCats?.find((x) => x.id === b.category_id);
    const limit = budgetLimitEur(b, rate);
    const used = spentById.get(b.category_id) ?? 0;
    return { id: b.id, name: c ? (locale === "tr" ? c.name_tr : c.name_en) : L.none, used, limit, alert: budgetAlertPct(b), pct: limit > 0 ? Math.min(100, (used / limit) * 100) : 0 };
  }).sort((a, b) => b.pct - a.pct).slice(0, 4);

  const upcoming = upcomingRules(rules ?? [], today).slice(0, 4);
  // Kredi kartı son ödeme günleri: borç (bakiye eksiyse) ve bir sonraki son ödeme tarihi
  const cardDues = accounts
    .filter((a) => a.type === "credit_card" && a.due_day)
    .map((a) => {
      const thisDue = dueDateISO(currentKey, a.due_day!);
      const due = thisDue >= today ? thisDue : dueDateISO(addMonthsKey(currentKey, 1), a.due_day!);
      return { id: a.id, name: a.name, currency: a.currency as Currency, debt: Math.max(0, -a.balance), due, days: Math.round((new Date(`${due}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 864e5) };
    })
    .sort((x, y) => x.days - y.days);

  // ── Cüzdanlar: her para birimi kendi içinde (çeviri yok) ──
  const tr = locale === "tr";
  const curNow = totalsByCurrency(six, currentKey);
  const curPrev = totalsByCurrency(six, prevKey);
  const fixedBy = remainingFixedByCurrency(rules ?? [], today);
  const wallets: WalletData[] = (["EUR", "TRY"] as Currency[]).flatMap((cur) => {
    const bal = walletBalances(accounts, cur);
    if (!bal.count) return [];
    const now = curNow[cur], prv = curPrev[cur];
    const al = dailyAllowance(now.net, today, now.exp, fixedBy[cur].total);
    const f = (n: number) => fmt(n, cur, locale);
    const fixedNames = fixedBy[cur].items.map((i) => i.name).slice(0, 3).join(", ");
    const text = al.free > 0
      ? (tr ? `Bu ay net ${f(now.net)}${fixedBy[cur].total > 0 ? `, ay sonuna kadar sabit giderler ${f(fixedBy[cur].total)} (${fixedNames}) düşülünce ${f(al.free)}` : ""} kaldı; ${al.daysLeft} gün (bugün dahil). Günlük ortalama gider: ${f(al.avgSoFar)}.`
            : `Net ${f(now.net)}${fixedBy[cur].total > 0 ? `, minus fixed costs ${f(fixedBy[cur].total)} (${fixedNames}) leaves ${f(al.free)}` : ""} over ${al.daysLeft} days (today included). Average daily spend: ${f(al.avgSoFar)}.`)
      : (now.net > 0
          ? (tr ? `Net ${f(now.net)} artıda ama ay sonuna kadar sabit giderler ${f(fixedBy[cur].total)}: günlük pay yok.` : `Net ${f(now.net)} but fixed costs due this month are ${f(fixedBy[cur].total)}: no daily allowance.`)
          : (tr ? `Bu ay net ${f(now.net)}: gelir giderleri karşılamıyor, günlük pay yok.` : `Net ${f(now.net)} this month: income does not cover expenses, so no daily allowance.`));
    return [{
      cur, title: cur === "EUR" ? (tr ? "EUR hesapların" : "EUR accounts") : (tr ? "TL hesapların" : "TRY accounts"),
      spendable: f(bal.spendable), approx: rate && cur === "TRY" ? fmt(toEur(bal.spendable, "TRY", rate), "EUR", locale) : undefined,
      blocked: bal.blocked !== 0 ? f(bal.blocked) : undefined, reserve: bal.reserve !== 0 ? f(bal.reserve) : undefined,
      inc: f(now.inc), incHint: now.payout > 0 ? `${tr ? "dışarıdan" : "external"} ${f(now.inc - now.payout)} + ${tr ? "bloke ödemesi" : "blocked payout"} ${f(now.payout)}` : undefined,
      deltaInc: deltaHint(now.inc, prv.inc, true), exp: f(now.exp), deltaExp: deltaHint(now.exp, prv.exp, false),
      net: f(now.net), netPositive: now.net >= 0,
      allowance: { ok: al.free > 0, perDay: f(al.perDay), text },
      labels: { spendable: L.spendableShort, income: `${L.income} · ${L.thisMonth}`, expense: `${L.expense} · ${L.thisMonth}`, net: `${L.net} · ${L.thisMonth}`, perDay: tr ? "gün" : "day", blocked: L.blockedShort, reserve: tr ? "Nakit kenar" : "Cash reserve", allowance: tr ? "Ay sonuna kadar günlük harcayabileceğin" : "You can spend per day until month end" },
    }];
  });

  const needsSetup = !accounts.length || !catCount;

  return (
    <div className="space-y-6">
      <PageHeader title={L.overview} description={new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${today}T00:00:00Z`))} />

      {needsSetup && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader><CardTitle>{L.getStarted}</CardTitle></CardHeader>
          <CardContent>
            <ol className="grid gap-2 text-sm sm:grid-cols-2">
              {[["/accounts", L.step1], ["/settings", L.step2], ["/recurring", L.step3], ["/rules", L.step4]].map(([href, label], i) => (
                <li key={href}>
                  <Link href={href} className="flex items-center gap-3 rounded-lg border bg-background p-3 transition-colors hover:bg-muted">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{i + 1}</span>
                    {label}
                  </Link>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      <section data-tour="summary" className="grid gap-4 lg:grid-cols-2">
        {wallets.map((w) => <WalletCard key={w.cur} w={w} />)}
      </section>
      {wallets.length > 1 && rate ? (
        <p className="-mt-2 text-xs text-muted-foreground">
          {tr ? "Cüzdanlar birbirine çevrilmeden gösterilir." : "Wallets are shown without converting between currencies."} {L.netWorthShort}: ≈ {fmt(worth, "EUR", locale)} · {fmt(toTry(worth, "EUR", rate), "TRY", locale)}
        </p>
      ) : null}

      {blockedTotal !== 0 && <p className="-mt-3 flex items-start gap-1.5 text-xs text-muted-foreground"><Lock className="mt-0.5 size-3 shrink-0" aria-hidden />{L.incomeNote}</p>}

      <section className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader><CardTitle>{L.cashflow}</CardTitle><CardDescription>{L.last6} · {locale === "tr" ? "€'ya çevrilmiş" : "converted to €"}</CardDescription></CardHeader>
          <CardContent><CashflowChart data={chartData} labels={{ income: L.income, expense: L.expense }} locale={locale} /></CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>{L.byCategory}</CardTitle><CardDescription>{L.thisMonth} · {locale === "tr" ? "€'ya çevrilmiş" : "converted to €"}</CardDescription></CardHeader>
          <CardContent>
            {!slices.length ? <p className="py-10 text-center text-sm text-muted-foreground">{L.empty}</p> : (
              <>
                <CategoryDonut data={slices} total={exp} totalLabel={L.expense} locale={locale} />
                <ul className="mt-3 space-y-1.5 text-sm">
                  {slices.map((s) => (
                    <li key={s.name} className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2"><span className="size-2.5 shrink-0 rounded-full" style={{ background: s.fill }} /><span className="truncate">{s.name}</span></span>
                      <span className="tnum text-muted-foreground">{fmt(s.value, "EUR", locale)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>{L.recent}</CardTitle>
            <CardAction><Link href="/transactions" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>{L.viewAll}</Link></CardAction>
          </CardHeader>
          <CardContent>
            {!recent?.length ? <EmptyState icon={Wallet} title={L.empty} /> : (
              <ul className="divide-y">
                {recent.map((r) => {
                  const cat = r.category as unknown as Cat;
                  const acc = r.account as unknown as { name: string } | null;
                  const toAcc = r.to_account as unknown as { name: string } | null;
                  const catLabel = cat ? (locale === "tr" ? cat.name_tr : cat.name_en) : null;
                  const title = r.kind === "transfer" ? `${acc?.name} → ${toAcc?.name}` : (r.merchant ?? catLabel ?? L.none);
                  return (
                    <li key={r.id} className="flex items-center gap-3 py-2.5">
                      <CategoryIcon name={catLabel} kind={r.kind} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{title}</div>
                        <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                          <span>{r.occurred_on}</span><span>·</span><span className="truncate">{acc?.name}</span>
                          {catLabel && r.kind !== "transfer" ? <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">{catLabel}</Badge> : null}
                        </div>
                      </div>
                      <div className={cn("tnum shrink-0 text-sm font-medium", r.kind === "income" && "text-positive")}>
                        {r.kind === "income" ? "+" : r.kind === "expense" ? "−" : "⇄ "}{fmt(Number(r.amount), r.currency as Currency, locale)}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{L.accounts}</CardTitle>
              <CardAction><Link href="/accounts" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>{L.viewAll}</Link></CardAction>
            </CardHeader>
            <CardContent>
              {!accounts.length ? <p className="text-sm text-muted-foreground">{L.empty}</p> : (
                <ul className="space-y-3">
                  {accounts.map((a) => (
                    <li key={a.id} className="flex items-center gap-3">
                      <AccountIcon type={a.type} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{a.name}</div>
                        <div className="text-xs text-muted-foreground">{a.currency}{a.type === "blocked" ? ` · ${L.typeBlocked}` : ""}</div>
                      </div>
                      <div className="tnum text-sm font-medium">{fmt(a.balance, a.currency, locale)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {cardDues.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><CreditCard className="size-4" aria-hidden />{locale === "tr" ? "Kart son ödemeleri" : "Card due dates"}</CardTitle>
                <CardAction><Link href="/notifications" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>{locale === "tr" ? "Bildirimler" : "Notifications"}</Link></CardAction>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2.5 text-sm">
                  {cardDues.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3">
                      <div className="min-w-0"><div className="truncate font-medium">{c.name}</div>
                        <div className={cn("text-xs text-muted-foreground", c.debt > 0 && c.days <= 3 && "font-medium text-amber-600")}>{c.due} · {c.days === 0 ? L.today : c.days === 1 ? L.tomorrow : `${c.days} ${L.daysLeft}`}</div></div>
                      <div className={cn("tnum shrink-0 font-medium", c.debt > 0 ? "text-negative" : "text-muted-foreground")}>{c.debt > 0 ? fmt(c.debt, c.currency, locale) : locale === "tr" ? "Borç yok" : "No debt"}</div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {upcoming.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><CalendarClock className="size-4" aria-hidden />{L.upcoming}</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-2.5 text-sm">
                  {upcoming.map((u) => (
                    <li key={u.id} className="flex items-center justify-between gap-3">
                      <div className="min-w-0"><div className="truncate font-medium">{u.name}</div>
                        <div className="text-xs text-muted-foreground">{u.due} · {u.days === 0 ? L.today : u.days === 1 ? L.tomorrow : `${u.days} ${L.daysLeft}`}</div></div>
                      <div className={cn("tnum shrink-0 font-medium", u.kind === "income" && "text-positive")}>{u.kind === "income" ? "+" : "−"}{fmt(Number(u.amount), u.currency as Currency, locale)}</div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{L.budgets}</CardTitle>
              <CardAction><Link href="/budgets" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>{L.viewAll}</Link></CardAction>
            </CardHeader>
            <CardContent>
              {!budgetRows.length ? <p className="text-sm text-muted-foreground">{L.noBudgets}</p> : (
                <ul className="space-y-3">
                  {budgetRows.map((b) => (
                    <li key={b.id} className="space-y-1.5">
                      <div className="flex justify-between gap-3 text-sm"><span className="truncate">{b.name}</span><span className="tnum text-muted-foreground">{fmt(b.used, "EUR", locale)} / {fmt(b.limit, "EUR", locale)}</span></div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", b.used > b.limit ? "bg-negative" : b.pct > b.alert ? "bg-chart-4" : "bg-positive")} style={{ width: `${b.pct}%` }} /></div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{L.goals}</CardTitle>
              <CardAction><Link href="/goals" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>{L.viewAll}</Link></CardAction>
            </CardHeader>
            <CardContent>
              {!goals?.length ? <p className="text-sm text-muted-foreground">{L.noGoals}</p> : (
                <ul className="space-y-3">
                  {goals.map((g) => {
                    const gp = goalProgress(g, accounts, rate);
                    const pct = gp.target > 0 ? Math.min(100, (gp.saved / gp.target) * 100) : 0;
                    return (
                      <li key={g.id} className="space-y-1.5">
                        <div className="flex justify-between gap-3 text-sm"><span className="truncate">{g.name}</span><span className="tnum text-muted-foreground">{pct.toFixed(0)}%</span></div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-chart-3" style={{ width: `${pct}%` }} /></div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}

import { adminClient, ownerId } from "@/lib/supabase/admin";
import { latestRate } from "@/lib/fx";
import { fetchAll } from "@/lib/paginate";
import { effectiveKind, type TxnRow } from "@/lib/dashboard";
import { fmt, toEur, toTry, type Currency } from "@/lib/money";
import { addDaysISO, todayISO } from "@/lib/date";

export async function balancesText(locale = "tr") {
  const db = adminClient();
  const uid = ownerId();
  const [{ data: accs }, { data: bals }] = await Promise.all([
    db.from("accounts").select("id,name,currency").eq("user_id", uid).eq("archived", false).order("sort_order"),
    db.from("account_balances").select("account_id,balance").eq("user_id", uid),
  ]);
  const rate = await latestRate(db);
  const map = new Map((bals ?? []).map((b) => [b.account_id, Number(b.balance)]));
  let eurTotal = 0;
  const lines = (accs ?? []).map((a) => {
    const v = map.get(a.id) ?? 0;
    eurTotal += toEur(v, a.currency as Currency, rate);
    return `${a.name}: ${fmt(v, a.currency as Currency, locale)}`;
  });
  lines.push(`—\nToplam: ${fmt(eurTotal, "EUR", locale)} (${fmt(toTry(eurTotal, "EUR", rate), "TRY", locale)})`);
  return lines.join("\n");
}

export async function periodSummary(days: number, locale = "tr") {
  const db = adminClient();
  const since = addDaysISO(todayISO(), -days);
  // Panelle aynı kural: bloke hesaptan harcanabilir hesaba geçen aylık ödeme gelirdir; diğer transferler sayılmaz.
  const data = await fetchAll<TxnRow>((a, b) => db
    .from("transactions")
    .select("kind,amount,currency,eur_try_rate,occurred_on,category_id,category:categories(name_tr,name_en),account:accounts!transactions_account_id_fkey(type),to_account:accounts!transactions_to_account_id_fkey(type)")
    .eq("user_id", ownerId()).gte("occurred_on", since).order("occurred_on").order("id").range(a, b));
  let inc = 0, exp = 0, payout = 0;
  const byCat = new Map<string, number>();
  for (const t of data) {
    const kind = effectiveKind(t);
    if (kind === "transfer") continue;
    const eur = toEur(Number(t.amount), t.currency as Currency, Number(t.eur_try_rate));
    if (kind === "income") {
      inc += eur;
      if (t.kind === "transfer") payout += eur;
    } else {
      exp += eur;
      const c = t.category?.name_tr ?? "Diğer";
      byCat.set(c, (byCat.get(c) ?? 0) + eur);
    }
  }
  const top = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([c, v]) => `${c}: ${fmt(v, "EUR", locale)}`).join(", ");
  const incomeLine = payout > 0 ? `Gelir: ${fmt(inc, "EUR", locale)} (dışarıdan ${fmt(inc - payout, "EUR", locale)} + bloke ödemesi ${fmt(payout, "EUR", locale)})` : `Gelir: ${fmt(inc, "EUR", locale)}`;
  return `Son ${days} gün\n${incomeLine}\nGider: ${fmt(exp, "EUR", locale)}\nNet: ${fmt(inc - exp, "EUR", locale)}${top ? `\nEn çok: ${top}` : ""}`;
}

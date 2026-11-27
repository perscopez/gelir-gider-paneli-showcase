import { Field, inputCls } from "@/components/field";
import type { Dict, Locale } from "@/lib/i18n";
import { todayISO } from "@/lib/date";

export type AccountOpt = { id: string; name: string; currency: string; type: string };
export type CategoryOpt = { id: string; name_tr: string; name_en: string; kind: string };

// Yeni işlem alanları: hem "Yeni işlem" diyaloğunda hem sayfada kullanılır. Koşullu alanlar form üzerindeki `group` sınıfıyla CSS ile açılıp kapanır.
export function TransactionFields({ accounts, categories, locale, L }: { accounts: AccountOpt[]; categories: CategoryOpt[]; locale: Locale; L: Dict }) {
  const transferOnly = "hidden group-has-[option[value=transfer]:checked]:contents";
  const notTransfer = "group-has-[option[value=transfer]:checked]:hidden";
  const catLabel = (c: CategoryOpt) => (locale === "tr" ? c.name_tr : c.name_en);
  const sorted = [...accounts].sort((a, b) => Number(a.type === "blocked" || a.type === "reserve") - Number(b.type === "blocked" || b.type === "reserve"));
  return (
    <>
      <Field label={L.kind}>
        <select name="kind" defaultValue="expense" className={inputCls}>
          <option value="expense">{L.kindExpense}</option>
          <option value="income">{L.kindIncome}</option>
          <option value="transfer">{L.kindTransfer}</option>
        </select>
      </Field>
      <Field label={L.account}>
        <select name="account_id" required className={inputCls}>
          {sorted.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
        </select>
      </Field>
      <Field label={L.amount} hint={L.amountHint}>
        <input name="amount" required inputMode="decimal" placeholder="0,00" className={inputCls} />
      </Field>
      <Field label={L.date}>
        <input name="occurred_on" type="date" defaultValue={todayISO()} className={inputCls} />
      </Field>
      <div className={transferOnly}>
        <Field label={L.toAccount} hint={L.transferHint}>
          <select name="to_account_id" defaultValue="" className={inputCls}>
            <option value="">—</option>
            {sorted.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
          </select>
        </Field>
        <Field label={L.toAmount} hint={L.toAmountHint}>
          <input name="to_amount" inputMode="decimal" className={inputCls} />
        </Field>
      </div>
      <Field label={L.categoryOpt} className={notTransfer}>
        <select name="category_id" defaultValue="" className={inputCls}>
          <option value="">—</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{catLabel(c)}</option>)}
        </select>
      </Field>
      <Field label={L.merchant}>
        <input name="merchant" className={inputCls} />
      </Field>
      <Field label={L.note}>
        <input name="note" className={inputCls} />
      </Field>
      <Field label={L.receipt} hint={L.receiptHint}>
        <input name="receipt" type="file" accept="image/*,application/pdf" className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium" />
      </Field>
    </>
  );
}

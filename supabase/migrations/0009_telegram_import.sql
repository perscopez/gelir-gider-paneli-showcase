create table if not exists telegram_statements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled')),
  expires_at timestamptz not null default now() + interval '1 day'
);
alter table telegram_statements enable row level security;
revoke all on telegram_statements from anon, authenticated;
grant select, insert, update, delete on telegram_statements to service_role;

create table if not exists telegram_statement_links (
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  external_id text not null,
  transaction_id uuid not null references transactions(id) on delete cascade,
  occurred_on date not null,
  primary key (user_id, external_id),
  unique (account_id, transaction_id)
);
alter table telegram_statement_links enable row level security;
revoke all on telegram_statement_links from anon, authenticated;
grant select, insert on telegram_statement_links to service_role;
grant select on telegram_statement_links to authenticated;
drop policy if exists telegram_statement_links_read on telegram_statement_links;
create policy telegram_statement_links_read on telegram_statement_links for select to authenticated
using (user_id = (select auth.uid()));

create or replace function finish_telegram_statement(
  p_id uuid, p_user uuid, p_confirm boolean, p_inserts jsonb, p_updates jsonb
) returns boolean language plpgsql set search_path = public as $$
declare item jsonb; snapshot jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('telegram-statement:' || p_user::text, 0));
  update telegram_statements set status = case when p_confirm then 'confirmed' else 'cancelled' end, payload = null
  where id = p_id and user_id = p_user and status = 'pending' and expires_at > now();
  if not found then return false; end if;
  if p_confirm then
    for item in select value from jsonb_array_elements(p_updates) loop
      snapshot := item->'expected';
      perform 1 from transactions t where t.id = (item->>'id')::uuid and t.user_id = p_user
        and to_jsonb(t) @> snapshot for update;
      if not found then raise exception 'Statement match changed'; end if;
      insert into telegram_statement_links(user_id, account_id, external_id, transaction_id, occurred_on)
      values (p_user, (item->>'accountId')::uuid, item->>'externalId', (item->>'id')::uuid, (item->>'date')::date);
    end loop;
    perform apply_statement(p_inserts);
  end if;
  return true;
end $$;

create or replace function attach_telegram_receipt(
  p_user uuid, p_id uuid, p_patch jsonb, p_items jsonb, p_file_key text
) returns void language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('telegram-receipt:' || p_user::text || ':' || p_file_key, 0));
  perform 1 from transactions where id = p_id and user_id = p_user and receipt_path is null for update;
  if not found or exists (
    select 1 from transactions where user_id = p_user and
      (external_id in ('tg:' || p_file_key, 'tgh:' || p_file_key)
       or strpos(receipt_path, '_' || p_file_key || '-tg.') > 0)
  ) then raise exception 'Receipt already attached'; end if;
  perform receipt_attach(p_id, p_patch, p_items);
end $$;

-- Satıra bağlı miktar, gider düzenlenir veya silinirse açılış düzeltmesini de geri alır.
alter table transactions add column if not exists cash_receipt_count_on date;

create or replace function balance_cash_receipt() returns trigger
language plpgsql set search_path = public as $$
declare adjustment numeric := 0; opening numeric; acc uuid; uid uuid; counted_on date;
begin
  if tg_op <> 'INSERT' then
    acc := old.account_id; uid := old.user_id; counted_on := old.cash_receipt_count_on;
    if counted_on is not null then adjustment := -old.amount; end if;
  end if;
  if tg_op <> 'DELETE' then
    if tg_op = 'INSERT' and current_user <> 'service_role' then new.cash_receipt_count_on := null; end if;
    if tg_op = 'UPDATE' then
      if old.cash_receipt_count_on is not null or current_user <> 'service_role' then
        new.cash_receipt_count_on := old.cash_receipt_count_on;
      end if;
      if new.account_id <> old.account_id or new.kind <> 'expense' or new.occurred_on > counted_on then
        new.cash_receipt_count_on := null;
      end if;
    end if;
    if new.cash_receipt_count_on is not null then
      acc := new.account_id; uid := new.user_id; counted_on := new.cash_receipt_count_on;
      adjustment := adjustment + new.amount;
    end if;
  end if;
  if adjustment <> 0 then
    select opening_balance into opening from accounts where id = acc and user_id = uid for update;
    if found then
      update accounts set opening_balance = opening + adjustment where id = acc;
      insert into balance_adjustments(user_id, account_id, as_of, old_opening, new_opening, delta, source)
      values (uid, acc, counted_on, opening, opening + adjustment, adjustment,
        'cash_receipt_backfill:' || counted_on::text);
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists balance_cash_receipt on transactions;
create trigger balance_cash_receipt before insert or update or delete on transactions
for each row execute function balance_cash_receipt();

create or replace function insert_telegram_receipt(p_txn jsonb, p_items jsonb, p_file_key text, p_backfill boolean) returns uuid
language plpgsql set search_path = public as $$
declare t transactions; counted_on date; txn_id uuid;
begin
  t := jsonb_populate_record(null::transactions, p_txn);
  perform pg_advisory_xact_lock(hashtextextended('telegram-receipt:' || t.user_id::text || ':' || p_file_key, 0));
  perform 1 from accounts where id = t.account_id and user_id = t.user_id and not archived for update;
  if not found or t.kind <> 'expense' then raise exception 'Expense account required'; end if;
  if exists (
    select 1 from transactions where user_id = t.user_id and
      (external_id in ('tg:' || p_file_key, 'tgh:' || p_file_key)
       or strpos(receipt_path, '_' || p_file_key || '-tg.') > 0
       or (account_id = t.account_id and occurred_on = t.occurred_on and kind = 'expense'
           and amount = t.amount and currency = t.currency and lower(merchant) = lower(t.merchant)))
  ) then raise exception 'Receipt already recorded'; end if;
  if p_backfill then
    select max(b.as_of) into counted_on from balance_adjustments b join accounts a on a.id = b.account_id
    where a.type = 'cash' and a.id = t.account_id and b.user_id = t.user_id
      and b.source like 'cash_count_pending_receipts:%';
  end if;
  txn_id := insert_txn_with_items(p_txn, p_items);
  if counted_on is not null and t.occurred_on < counted_on then
    -- Aynı günün saatini bilmiyoruz. Yalnızca sayım gününden önceki fişleri telafi et.
    update transactions set cash_receipt_count_on = counted_on where id = txn_id;
  end if;
  return txn_id;
end $$;

revoke execute on function finish_telegram_statement(uuid, uuid, boolean, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function attach_telegram_receipt(uuid, uuid, jsonb, jsonb, text) from public, anon, authenticated;
revoke execute on function insert_telegram_receipt(jsonb, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function finish_telegram_statement(uuid, uuid, boolean, jsonb, jsonb) to service_role;
grant execute on function attach_telegram_receipt(uuid, uuid, jsonb, jsonb, text) to service_role;
grant execute on function insert_telegram_receipt(jsonb, jsonb, text, boolean) to service_role;

-- Gelir Gider Paneli: ilk şema
-- Supabase SQL Editor'de çalıştır. Tek kullanıcılı uygulama; RLS her tabloda user_id = auth.uid() ister.

create extension if not exists "pgcrypto";

-- ───────── Hesaplar ─────────
create type account_type as enum ('bank', 'cash', 'credit_card', 'blocked');
create type txn_kind as enum ('income', 'expense', 'transfer');
create type txn_source as enum ('manual', 'csv', 'email', 'apple_pay', 'telegram', 'recurring');

create table accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,                       -- "Fabrikam Bloke", "Lale Bank Vadesiz"
  institution text,
  type account_type not null,
  currency text not null check (currency in ('EUR', 'TRY')),
  opening_balance numeric(14,2) not null default 0,
  -- kredi kartı
  statement_day smallint check (statement_day between 1 and 31),
  due_day smallint check (due_day between 1 and 31),
  credit_limit numeric(14,2),
  -- bloke hesap
  blocked_end_date date,
  archived boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- ───────── Kategoriler ─────────
create table categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name_tr text not null,
  name_en text not null,
  kind txn_kind not null check (kind in ('income', 'expense')),
  icon text,
  created_at timestamptz not null default now()
);

-- ───────── İşlemler ─────────
create table transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete restrict,
  to_account_id uuid references accounts(id) on delete restrict,  -- sadece transfer
  category_id uuid references categories(id) on delete set null,
  kind txn_kind not null,
  amount numeric(14,2) not null check (amount > 0),   -- hesabın para biriminde
  to_amount numeric(14,2),                            -- transferde hedef hesap tutarı
  currency text not null check (currency in ('EUR', 'TRY')),
  eur_try_rate numeric(12,6) not null,                -- işlem gününde 1 EUR = x TRY
  occurred_on date not null default current_date,
  merchant text,
  note text,
  tags text[] not null default '{}',
  source txn_source not null default 'manual',
  external_id text,                                   -- tekrar içe aktarmayı önlemek için
  receipt_path text,                                  -- storage: receipts bucket
  recurring_rule_id uuid,
  created_at timestamptz not null default now(),
  constraint transfer_needs_target check (
    (kind = 'transfer' and to_account_id is not null and to_amount is not null)
    or (kind <> 'transfer' and to_account_id is null)
  )
);
create unique index transactions_external_uidx on transactions (user_id, external_id) where external_id is not null;
create index transactions_date_idx on transactions (user_id, occurred_on desc);
create index transactions_account_idx on transactions (account_id);

-- ───────── Tekrarlayan işlemler / faturalar ─────────
create table recurring_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,                                  -- "Fabrikam aylık ödeme", "Kira"
  account_id uuid not null references accounts(id) on delete cascade,
  category_id uuid references categories(id) on delete set null,
  kind txn_kind not null check (kind in ('income', 'expense')),
  amount numeric(14,2) not null check (amount > 0),
  currency text not null check (currency in ('EUR', 'TRY')),
  day_of_month smallint not null check (day_of_month between 1 and 31),
  auto_create boolean not null default true,           -- false: sadece hatırlat
  remind_days_before smallint not null default 2,
  start_date date not null default current_date,
  end_date date,
  last_run_on date,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table transactions add constraint transactions_rule_fk
  foreign key (recurring_rule_id) references recurring_rules(id) on delete set null;

-- ───────── Bütçeler (aylık, kategori başına, EUR) ─────────
create table budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id uuid not null references categories(id) on delete cascade,
  monthly_limit_eur numeric(14,2) not null check (monthly_limit_eur > 0),
  unique (user_id, category_id)
);

-- ───────── Birikim hedefleri (piggy bank) ─────────
create table goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  target_eur numeric(14,2) not null check (target_eur > 0),
  saved_eur numeric(14,2) not null default 0,
  target_date date,
  created_at timestamptz not null default now()
);

-- ───────── Otomatik kategori kuralları ─────────
create table category_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  pattern text not null,                               -- küçük harfle "contains" eşleşmesi: "migros"
  category_id uuid not null references categories(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ───────── Kur geçmişi ─────────
create table fx_rates (
  day date primary key,
  eur_try numeric(12,6) not null
);

-- ───────── Kullanıcı ayarları ─────────
create table user_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  locale text not null default 'tr' check (locale in ('tr', 'en')),
  telegram_chat_id bigint,
  weekly_summary boolean not null default true,
  created_at timestamptz not null default now()
);

-- ───────── Bakiye görünümü (hesap para biriminde) ─────────
create view account_balances with (security_invoker = true) as
select
  a.id as account_id,
  a.user_id,
  a.opening_balance
    + coalesce(sum(case when t.account_id = a.id and t.kind = 'income'   then t.amount end), 0)
    - coalesce(sum(case when t.account_id = a.id and t.kind = 'expense'  then t.amount end), 0)
    - coalesce(sum(case when t.account_id = a.id and t.kind = 'transfer' then t.amount end), 0)
    + coalesce(sum(case when t.to_account_id = a.id and t.kind = 'transfer' then t.to_amount end), 0)
    as balance
from accounts a
left join transactions t on t.account_id = a.id or t.to_account_id = a.id
group by a.id, a.user_id, a.opening_balance;

-- ───────── RLS: sadece kendi satırların ─────────
do $$
declare t text;
begin
  foreach t in array array['accounts','categories','transactions','recurring_rules','budgets','goals','category_rules','user_settings']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "owner_all" on %I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

alter table fx_rates enable row level security;
create policy "fx_read" on fx_rates for select using (auth.uid() is not null);

-- ───────── Fiş dosyaları için özel bucket ─────────
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false)
  on conflict do nothing;
create policy "receipts_owner" on storage.objects for all
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

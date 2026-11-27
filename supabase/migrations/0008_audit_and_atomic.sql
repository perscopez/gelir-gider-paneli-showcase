-- 1) Açılış bakiyesi düzeltme kaydı (denetim izi): ekstre eşitlemesi açılış bakiyesini ne zaman, ne kadar değiştirdi.
-- 2) Atomik yazma fonksiyonları (RPC): fiş + kalemleri ve ekstre ekleme/güncelleme tek veritabanı işleminde yapılır; ağ kopsa bile yarım kayıt kalmaz.
-- Supabase SQL Editor'de bir kez çalıştır; tekrar çalıştırmak güvenlidir.

create table if not exists balance_adjustments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  as_of date not null,                       -- ekstrenin bakiye tarihi
  statement_balance numeric(14,2),           -- ekstredeki bakiye
  old_opening numeric(14,2) not null,
  new_opening numeric(14,2) not null,
  delta numeric(14,2) not null,
  source text not null default 'statement',
  created_at timestamptz not null default now()
);
create index if not exists balance_adjustments_acc_idx on balance_adjustments (account_id, created_at desc);
alter table balance_adjustments enable row level security;
drop policy if exists "owner_all" on balance_adjustments;
create policy "owner_all" on balance_adjustments for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Kalem satırlarını fişin işlemine bağlayarak ekler (para birimi yoksa işlemin para birimi).
create or replace function _insert_receipt_items(p_txn_id uuid, p_user uuid, p_cur text, p_items jsonb) returns void
language plpgsql as $$
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then return; end if;
  insert into receipt_items (user_id, transaction_id, line_no, name, product, brand, quantity, unit, pack_amount, pack_unit, unit_price, line_total,
                             category, base_unit, price_per_base, merchant, purchased_on, currency)
  select p_user, p_txn_id, r.line_no, r.name, r.product, r.brand, coalesce(r.quantity, 1), r.unit, r.pack_amount, r.pack_unit, r.unit_price, r.line_total,
         coalesce(r.category, 'Diğer'), r.base_unit, r.price_per_base, r.merchant, r.purchased_on, coalesce(r.currency, p_cur)
  from jsonb_populate_recordset(null::receipt_items, p_items) r;
end $$;

-- İşlem + fiş kalemleri tek işlemde. p_txn: işlem alanları (id verilmezse üretilir). Döner: işlem kimliği.
create or replace function insert_txn_with_items(p_txn jsonb, p_items jsonb default '[]'::jsonb) returns uuid
language plpgsql as $$
declare new_id uuid; uid uuid; cur text;
begin
  insert into transactions (id, user_id, account_id, to_account_id, category_id, kind, amount, to_amount, currency, eur_try_rate, occurred_on, merchant, note, receipt_path, source, external_id)
  select coalesce(r.id, gen_random_uuid()), coalesce(r.user_id, auth.uid()), r.account_id, r.to_account_id, r.category_id, r.kind, r.amount, r.to_amount, r.currency, r.eur_try_rate,
         coalesce(r.occurred_on, current_date), r.merchant, r.note, r.receipt_path, coalesce(r.source, 'manual'::txn_source), r.external_id
  from jsonb_populate_record(null::transactions, p_txn) r
  returning id, user_id, currency into new_id, uid, cur;
  perform _insert_receipt_items(new_id, uid, cur, p_items);
  return new_id;
end $$;

-- Var olan bir işleme fiş (dosya yolu, kategori, not) ve kalemleri bağlar: güncelleme + kalem ekleme tek işlemde.
create or replace function receipt_attach(p_txn_id uuid, p_patch jsonb, p_items jsonb default '[]'::jsonb) returns void
language plpgsql as $$
declare uid uuid; cur text;
begin
  update transactions set
    receipt_path = case when p_patch ? 'receipt_path' then p_patch->>'receipt_path' else receipt_path end,
    category_id  = case when p_patch ? 'category_id' then (p_patch->>'category_id')::uuid else category_id end,
    note         = case when p_patch ? 'note' then p_patch->>'note' else note end
  where id = p_txn_id
  returning user_id, currency into uid, cur;
  if not found then raise exception 'işlem bulunamadı: %', p_txn_id; end if;
  perform _insert_receipt_items(p_txn_id, uid, cur, p_items);
end $$;

-- Ekstre uygulaması: yeni işlemler + mevcut kayıtların güncellenmesi (bağla / gerçek tutara düzelt / karta transfere çevir) tek işlemde.
-- p_updates: [{ "id": uuid, "patch": { "external_id"?, "amount"?, "occurred_on"?, "kind"?, "to_account_id"?, "to_amount"?, "category_id"? } }]
create or replace function apply_statement(p_inserts jsonb default '[]'::jsonb, p_updates jsonb default '[]'::jsonb) returns integer
language plpgsql as $$
declare e jsonb; n integer := 0;
begin
  if p_inserts is not null and jsonb_typeof(p_inserts) = 'array' and jsonb_array_length(p_inserts) > 0 then
    insert into transactions (id, user_id, account_id, to_account_id, category_id, kind, amount, to_amount, currency, eur_try_rate, occurred_on, merchant, note, source, external_id)
    select coalesce(r.id, gen_random_uuid()), coalesce(r.user_id, auth.uid()), r.account_id, r.to_account_id, r.category_id, r.kind, r.amount, r.to_amount, r.currency, r.eur_try_rate,
           coalesce(r.occurred_on, current_date), r.merchant, r.note, coalesce(r.source, 'csv'::txn_source), r.external_id
    from jsonb_populate_recordset(null::transactions, p_inserts) r;
    get diagnostics n = row_count;
  end if;
  if p_updates is not null and jsonb_typeof(p_updates) = 'array' then
    for e in select * from jsonb_array_elements(p_updates) loop
      update transactions set
        external_id   = case when e->'patch' ? 'external_id' then e->'patch'->>'external_id' else external_id end,
        amount        = case when e->'patch' ? 'amount' then (e->'patch'->>'amount')::numeric else amount end,
        occurred_on   = case when e->'patch' ? 'occurred_on' then (e->'patch'->>'occurred_on')::date else occurred_on end,
        kind          = case when e->'patch' ? 'kind' then (e->'patch'->>'kind')::txn_kind else kind end,
        to_account_id = case when e->'patch' ? 'to_account_id' then (e->'patch'->>'to_account_id')::uuid else to_account_id end,
        to_amount     = case when e->'patch' ? 'to_amount' then (e->'patch'->>'to_amount')::numeric else to_amount end,
        category_id   = case when e->'patch' ? 'category_id' then (e->'patch'->>'category_id')::uuid else category_id end
      where id = (e->>'id')::uuid;
    end loop;
  end if;
  return n;
end $$;

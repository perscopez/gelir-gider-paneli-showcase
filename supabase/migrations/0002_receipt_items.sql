-- Fiş kalemleri: market alışverişlerinde fişteki her ürün satırı. Gelecekte fiyat karşılaştırma / market optimizasyonu için.
-- Supabase SQL Editor'de bir kez çalıştır. Birden fazla çalıştırmak güvenlidir.

create table if not exists receipt_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  transaction_id uuid not null references transactions(id) on delete cascade,
  line_no int not null,
  name text not null,                    -- fişte yazdığı gibi: "BIO VOLLMILCH 1L"
  product text,                          -- marka ve ambalajsız genel ad: "Vollmilch"
  brand text,
  quantity numeric(12,3) not null default 1,   -- adet, tartılı üründe kg
  unit text,                             -- quantity'nin birimi: pcs | kg | g | l | ml
  pack_amount numeric(12,3),             -- ambalaj büyüklüğü: 1 (l), 500 (g)
  pack_unit text,
  unit_price numeric(12,2),              -- fişte yazan birim fiyat
  line_total numeric(12,2) not null,     -- satır toplamı; indirimlerde negatif
  category text not null default 'Diğer',-- alt kategori (Süt, Yumurta & Peynir, Meyve & Sebze, ...)
  base_unit text,                        -- fiyat karşılaştırma birimi: kg | l | pcs
  price_per_base numeric(12,4),          -- € / kg, € / l veya € / adet
  merchant text,                         -- işlemden kopya: mağaza karşılaştırması için
  purchased_on date,
  currency text not null default 'EUR',
  created_at timestamptz not null default now()
);

create index if not exists receipt_items_tx_idx on receipt_items (transaction_id, line_no);
create index if not exists receipt_items_product_idx on receipt_items (user_id, product, purchased_on desc);
create index if not exists receipt_items_category_idx on receipt_items (user_id, category, purchased_on desc);

alter table receipt_items enable row level security;
drop policy if exists "owner_all" on receipt_items;
create policy "owner_all" on receipt_items for all using (user_id = auth.uid()) with check (user_id = auth.uid());

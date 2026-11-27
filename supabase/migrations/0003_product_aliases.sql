-- Öğrenen ürün eşleştirmesi: fişteki kısaltılmış ad + market -> gerçek ürün/fotoğraf. "Yanlış ürün mü?" ile seçtiğin eşleşme burada saklanır,
-- aynı kalem sonraki fişlerde otomatik doğru çıkar. Supabase SQL Editor'de bir kez çalıştır; tekrar çalıştırmak güvenlidir.

create table if not exists product_aliases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  merchant text not null default '',     -- market anahtarı (lidl, rewe, ...), bilinmiyorsa küçük harfli ad
  alias text not null,                   -- fişteki ad, normalleştirilmiş ("vollmilch 1l")
  product text,                          -- genel ürün adı
  brand text,
  title text,                            -- eşleşen ürünün gösterim adı
  image text,
  url text,
  source text,
  barcode text,
  hits int not null default 1,
  updated_at timestamptz not null default now(),
  unique (user_id, merchant, alias)
);

alter table product_aliases enable row level security;
drop policy if exists "owner_all" on product_aliases;
create policy "owner_all" on product_aliases for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Her şeyi özelleştirilebilir yap: bütçe (para birimi, uyarı eşiği, geçerlilik aralığı, çoklu), hedef (para birimi, hesaba bağlama),
-- kategori (yerleşik anahtar: yeniden adlandırınca otomatik kategorileme bozulmasın), hesap (eşleşme kelimeleri: yeniden adlandırınca Apple Pay/Gmail eşleşmesi bozulmasın).
-- Supabase SQL Editor'de bir kez çalıştır; tekrar çalıştırmak güvenlidir.

alter table budgets add column if not exists currency text not null default 'EUR' check (currency in ('EUR', 'TRY'));
alter table budgets add column if not exists alert_pct smallint not null default 80 check (alert_pct between 1 and 100);
alter table budgets add column if not exists valid_from date;
alter table budgets add column if not exists valid_to date;
alter table budgets add column if not exists label text;
alter table budgets drop constraint if exists budgets_user_id_category_id_key;
create unique index if not exists budgets_user_cat_from_uidx on budgets (user_id, category_id, coalesce(valid_from, date '1900-01-01'));

alter table goals add column if not exists currency text not null default 'EUR' check (currency in ('EUR', 'TRY'));
alter table goals add column if not exists account_id uuid references accounts(id) on delete set null;

alter table categories add column if not exists builtin_key text;
update categories set builtin_key = name_tr
 where builtin_key is null and name_tr in ('Bloke hesap ödemesi', 'Aile desteği', 'Freelance / iş', 'Diğer gelir', 'Kira', 'Market', 'Dışarıda yemek', 'Ulaşım',
   'Faturalar', 'Abonelikler', 'Sağlık', 'Alışveriş', 'Eğlence', 'Seyahat', 'Eğitim', 'Diğer gider');

alter table accounts add column if not exists match_keys text;

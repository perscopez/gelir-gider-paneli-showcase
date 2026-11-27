-- Yeni hesap türü: "Nakit kenar" (reserve). Harcanabilir bakiyeye sayılmaz; buradan harcanabilir hesaba transfer gelir sayılır. Supabase SQL Editor'de bir kez çalıştır.
alter type account_type add value if not exists 'reserve';

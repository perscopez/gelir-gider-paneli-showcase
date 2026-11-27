-- Uygulama içi bildirim kutusu: Telegram/e-posta ile giden her bildirim burada da saklanır. Supabase SQL Editor'de bir kez çalıştır.
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  body text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on notifications (user_id, created_at desc);
alter table notifications enable row level security;
drop policy if exists "owner_all" on notifications;
create policy "owner_all" on notifications for all using (user_id = auth.uid()) with check (user_id = auth.uid());

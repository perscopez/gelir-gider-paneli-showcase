-- Tekrarlayan kurallar artık transfer de olabilir (örn. Fabrikam Bloke → Fabrikam Banka aylık 1000 €).
alter table recurring_rules add column if not exists to_account_id uuid references accounts(id) on delete cascade;
alter table recurring_rules drop constraint if exists recurring_rules_kind_check;
alter table recurring_rules add constraint recurring_rules_kind_check check (kind in ('income', 'expense', 'transfer'));
alter table recurring_rules add constraint recurring_rules_transfer_target check ((kind = 'transfer') = (to_account_id is not null));

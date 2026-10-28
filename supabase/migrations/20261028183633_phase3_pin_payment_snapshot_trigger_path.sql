-- The function uses a fully-qualified table reference. Pin search_path empty
-- to remove Supabase's mutable-path warning without changing trigger behavior.
alter function public.copy_payment_tax_decision_snapshot() set search_path = '';

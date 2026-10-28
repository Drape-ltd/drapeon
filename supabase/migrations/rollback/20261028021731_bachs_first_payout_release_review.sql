-- Rollback for migration 20261028021731.
drop function if exists public.ops_review_bachs_first_payout_release(uuid, uuid, text, text, text);

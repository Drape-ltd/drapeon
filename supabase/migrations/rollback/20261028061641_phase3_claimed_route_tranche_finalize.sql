-- Forward-only safety note for 20261028061641.
--
-- Do not drop the reconciled finalizer after it has written a settlement ledger
-- receipt or the escrow marker. A rollback is an application/code rollback:
-- stop calling the new provider-neutral RPC and retain the DB routines and
-- audit evidence. Restore functionality only with a reviewed forward migration.
-- This file is intentionally a no-op so an automated rollback cannot remove
-- financial evidence or reopen the terminal-order mutation surface.
select 'Forward-only financial finalizer retained; roll back callers, not ledger state.' as rollback_note;

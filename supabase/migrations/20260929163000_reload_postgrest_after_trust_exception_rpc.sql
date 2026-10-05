-- The waiver RPC was replaced under its existing name. Tell PostgREST to
-- refresh its cached function signature/body mapping after this transaction.
notify pgrst, 'reload schema';

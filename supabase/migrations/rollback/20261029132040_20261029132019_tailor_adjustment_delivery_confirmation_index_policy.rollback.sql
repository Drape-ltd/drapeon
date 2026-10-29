-- These provider-payout delivery receipts are forward-only. Preserve them and
-- their party-read policy; do not remove audit evidence or reopen payout gates.
do $$ begin
  raise exception 'Adjustment delivery confirmation guard is forward-only; use a reviewed replacement migration';
end $$;

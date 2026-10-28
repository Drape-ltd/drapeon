-- Forward-only payment guards are not removed after release. Correct them with
-- a reviewed forward migration; this script intentionally refuses to drop them.
do $$
begin
  raise exception 'TIP payout claim runtime gates are forward-only; do not drop them.';
end;
$$;

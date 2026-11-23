-- Forward-only financial allocation foundation. Dropping these tables could
-- erase the charge-to-release/refund evidence once provider calls use them.
-- Correct a defect with a reviewed forward migration instead.
do $$
begin
  raise exception 'Funding-position tables are forward-only; do not drop money allocation evidence.';
end;
$$;

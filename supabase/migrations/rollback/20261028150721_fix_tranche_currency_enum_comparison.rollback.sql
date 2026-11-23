-- Forward-only payment-route repair; do not restore the runtime-failing
-- text/enum comparison. Correct future issues with a forward migration.
do $$
begin
  raise exception 'Tranche currency comparison repair is forward-only.';
end;
$$;

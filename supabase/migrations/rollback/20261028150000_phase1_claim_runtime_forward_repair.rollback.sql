-- Forward-only Production compatibility repair. These claim RPCs are required
-- by deployed payment code; dropping them could make accepted obligations
-- unpayable. Correct mistakes with a reviewed forward migration instead.
do $$
begin
  raise exception 'This claim-runtime repair is forward-only; do not drop payment claim APIs.';
end;
$$;

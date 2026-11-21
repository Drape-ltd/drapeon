-- Development-only PR 2, Stage 4 migration 2/5.
-- The function was renamed to _v1 in Stage 3. Preserve its body and all
-- existing transition guards while changing only the postcode condition.
do $$
declare
  v_definition text;
  v_old text := 'or char_length(trim(coalesce(p_pickup_postal_code,''''))) not between 2 and 32';
  v_new text := 'or (char_length(trim(coalesce(p_pickup_postal_code,''''))) not between 2 and 32 and not (p_pickup_country_code in (''GH'',''NG'') and nullif(trim(coalesce(p_pickup_postal_code,'''')),'''') is null))';
begin
  select pg_get_functiondef('public.prepare_tailor_profile_claim_v1(text,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,jsonb)'::regprocedure)
    into v_definition;
  if v_definition is null or position(v_old in v_definition) = 0 then
    raise exception 'Unexpected prepare_tailor_profile_claim_v1 definition; aborting postcode migration';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$$;

-- Store a missing postcode as NULL, matching the rest of pickup and delivery
-- handling. Keep the receipt's original request intact for idempotent replay.
do $$
declare
  v_definition text;
  v_old text := 'v_request->>''pickupCity'',v_request->>''pickupRegion'',v_request->>''pickupPostalCode'',';
  v_new text := 'v_request->>''pickupCity'',v_request->>''pickupRegion'',nullif(trim(v_request->>''pickupPostalCode''),''''),';
begin
  select pg_get_functiondef('public.complete_tailor_profile_claim(uuid,uuid,text)'::regprocedure)
    into v_definition;
  if v_definition is null or position(v_old in v_definition) = 0 then
    raise exception 'Unexpected complete_tailor_profile_claim definition; aborting postcode migration';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$$;

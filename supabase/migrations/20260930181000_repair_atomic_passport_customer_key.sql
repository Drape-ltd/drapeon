-- Forward repair: customer_profiles.user_id is text in some deployed schemas.
-- Keep the UUID Edge contract but compare the physical key as text.
do $migration$
begin
execute $definition$
create or replace function public.claim_diary_passport_atomic(
  p_passport_id uuid,
  p_customer_id uuid,
  p_measurement_patch jsonb,
  p_expected_updated_at timestamptz
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_entry public.diary_entries%rowtype;
  v_customer public.customer_profiles%rowtype;
  v_existing jsonb;
  v_merged jsonb;
  v_label text;
begin
  if jsonb_typeof(p_measurement_patch) is distinct from 'object' then
    raise exception 'Invalid passport measurements' using errcode = '22023';
  end if;

  select * into v_entry from public.diary_entries
    where passport_id = p_passport_id for update;
  if not found then
    return jsonb_build_object('success', false, 'code', 'NOT_FOUND');
  end if;
  if v_entry.claimed_by_user_id is not null then
    if v_entry.claimed_by_user_id = p_customer_id then
      return jsonb_build_object('success', true, 'alreadyOwned', true);
    end if;
    return jsonb_build_object('success', false, 'code', 'ALREADY_CLAIMED');
  end if;
  if v_entry.invite_status = 'CLAIMED' then
    return jsonb_build_object('success', false, 'code', 'ALREADY_CLAIMED');
  end if;
  if v_entry.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('success', false, 'code', 'STALE');
  end if;
  if v_entry.invite_expires_at is not null and v_entry.invite_expires_at < now() then
    return jsonb_build_object('success', false, 'code', 'EXPIRED');
  end if;

  select * into v_customer from public.customer_profiles
    where user_id::text = p_customer_id::text for update;
  if not found then
    return jsonb_build_object('success', false, 'code', 'NOT_CUSTOMER');
  end if;

  v_existing := case when jsonb_typeof(v_customer.measurements) = 'object'
    then v_customer.measurements else '{}'::jsonb end;
  v_merged := v_existing || p_measurement_patch;
  v_merged := jsonb_set(v_merged, '{confidenceByField}',
    (case when jsonb_typeof(v_existing->'confidenceByField') = 'object'
      then v_existing->'confidenceByField' else '{}'::jsonb end)
    || (case when jsonb_typeof(p_measurement_patch->'confidenceByField') = 'object'
      then p_measurement_patch->'confidenceByField' else '{}'::jsonb end), true);
  v_label := left(coalesce(nullif(trim(v_entry.full_name), ''), 'Tailor passport'), 80);

  insert into public.customer_measurement_profiles (
    customer_id, label, relationship, measurements, unit_preference,
    source, is_default, last_measured_at
  ) values (
    p_customer_id, v_label, 'SELF', v_merged, v_entry.measurement_unit,
    'PASSPORT_CLAIM', false, coalesce(v_entry.measured_at::timestamptz, now())
  );

  update public.customer_profiles set measurements = v_merged
    where user_id::text = p_customer_id::text;

  update public.diary_entries
    set invite_status = 'CLAIMED', claimed_by_user_id = p_customer_id,
        updated_at = now()
    where id = v_entry.id;

  return jsonb_build_object('success', true, 'alreadyOwned', false);
end;
$$;
$definition$;
end;
$migration$;

-- Queue both sides' passport-claim communications in the same transaction as
-- the measurement transfer. The stable event keys make replay idempotent.
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
  v_base_key text;
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

  v_base_key := 'diary-passport-claimed:' || v_entry.passport_id::text || ':' || p_customer_id::text;

  perform public.enqueue_domain_event(
    p_event_type => 'diary_passport.claimed.customer',
    p_aggregate_type => 'diary_entry',
    p_aggregate_id => v_entry.id::text,
    p_idempotency_key => v_base_key || ':customer',
    p_actor_id => p_customer_id,
    p_actor_role => 'CUSTOMER',
    p_payload => jsonb_build_object(
      'userId', p_customer_id::text,
      'notification', jsonb_build_object(
        'title', 'Measurements added to your profile',
        'body', 'Your tailor-prepared fit measurements are now saved in your Drapeon profile.',
        'data', jsonb_build_object('type', 'PASSPORT_CLAIMED', 'screen', '/(customer)/profile/measurements'),
        'preferenceKey', 'orderUpdates',
        'communication', jsonb_build_object('category', 'ACCOUNT', 'purpose', 'TRANSACTIONAL', 'severity', 'INFO', 'mandatory', true, 'inApp', true, 'destinationKey', 'MEASUREMENTS', 'destinationParams', '{}'::jsonb, 'deduplicationKey', v_base_key || ':customer:in-app')
      ),
      'subject', 'Your fit measurements are ready in Drapeon',
      'headline', 'Your tailor-prepared measurements are saved',
      'body', 'The measurements your tailor prepared have been added to your Drapeon fit profile. Review them before using them in a future order.',
      'ctaLabel', 'Review measurements',
      'webPath', '/account/measurements'
    ),
    p_metadata => jsonb_build_object('source', 'claim-passport', 'audience', 'CUSTOMER'),
    p_jobs => array['SEND_PUSH', 'SEND_ACCOUNT_EVENT_EMAIL']::text[],
    p_priority => 25,
    p_max_attempts => 8,
    p_run_at => now()
  );

  perform public.enqueue_domain_event(
    p_event_type => 'diary_passport.claimed.tailor',
    p_aggregate_type => 'diary_entry',
    p_aggregate_id => v_entry.id::text,
    p_idempotency_key => v_base_key || ':tailor',
    p_actor_id => p_customer_id,
    p_actor_role => 'CUSTOMER',
    p_payload => jsonb_build_object(
      'userId', v_entry.tailor_id::text,
      'notification', jsonb_build_object(
        'title', 'Client passport claimed',
        'body', v_entry.full_name || ' added the measurements you prepared to their Drapeon profile.',
        'data', jsonb_build_object('type', 'PASSPORT_CLAIMED', 'screen', '/(tailor)/clients'),
        'preferenceKey', 'orderUpdates',
        'communication', jsonb_build_object('category', 'ACCOUNT', 'purpose', 'TRANSACTIONAL', 'severity', 'INFO', 'mandatory', true, 'inApp', true, 'destinationKey', 'CLIENTS', 'destinationParams', jsonb_build_object('tab', 'diary', 'filter', 'claimed'), 'deduplicationKey', v_base_key || ':tailor:in-app')
      ),
      'subject', 'A client claimed their Drapeon fit passport',
      'headline', 'Your client added their measurements',
      'body', v_entry.full_name || ' claimed the fit passport you prepared. Their measurements are now saved in their Drapeon profile.',
      'ctaLabel', 'Open client diary',
      'webPath', '/account/clients?tab=diary&filter=claimed'
    ),
    p_metadata => jsonb_build_object('source', 'claim-passport', 'audience', 'TAILOR'),
    p_jobs => array['SEND_PUSH', 'SEND_ACCOUNT_EVENT_EMAIL']::text[],
    p_priority => 25,
    p_max_attempts => 8,
    p_run_at => now()
  );

  return jsonb_build_object('success', true, 'alreadyOwned', false);
end;
$$;
$definition$;
execute 'revoke all on function public.claim_diary_passport_atomic(uuid, uuid, jsonb, timestamptz) from public, anon, authenticated';
execute 'grant execute on function public.claim_diary_passport_atomic(uuid, uuid, jsonb, timestamptz) to service_role';
end;
$migration$;

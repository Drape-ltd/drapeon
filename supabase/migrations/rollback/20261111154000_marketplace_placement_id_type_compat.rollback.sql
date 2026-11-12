-- Restore the ops_set_marketplace_category body installed by 20261111151000.
CREATE OR REPLACE FUNCTION public.ops_set_marketplace_category(p_tailor_profile_id text, p_category marketplace_category, p_reason text, p_actor text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_profile public.tailor_profiles%rowtype;
  v_decision public.marketplace_category_decisions%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_actor text := btrim(coalesce(p_actor, ''));
  v_key text := btrim(coalesce(p_idempotency_key, ''));
begin
  if char_length(v_reason) not between 12 and 500 then
    raise exception 'Reason must be between 12 and 500 characters.' using errcode = '22023';
  end if;
  if v_actor = '' or char_length(v_actor) > 200 then
    raise exception 'A valid actor is required.' using errcode = '22023';
  end if;
  if char_length(v_key) not between 8 and 200 then
    raise exception 'A valid idempotency key is required.' using errcode = '22023';
  end if;

  select * into v_decision from public.marketplace_category_decisions where idempotency_key = v_key;
  if found then
    if v_decision.tailor_profile_id <> p_tailor_profile_id or v_decision.to_category <> p_category then
      raise exception 'Idempotency key was already used for a different decision.' using errcode = '23505';
    end if;
    return jsonb_build_object('changed', false, 'replayed', true, 'category', v_decision.to_category, 'decisionId', v_decision.id);
  end if;

  select * into v_profile from public.tailor_profiles where id = p_tailor_profile_id for update;
  if not found then raise exception 'Tailor profile not found.' using errcode = 'P0002'; end if;
  if p_category = 'TAILORING'::public.marketplace_category
    and coalesce(v_profile.supports_custom_orders, false) = false then
    raise exception 'PLACEMENT_REQUIRES_CUSTOM_ORDERS: This seller does not take custom orders, so it cannot be placed in Tailors.'
      using errcode = '23514';
  end if;
  if v_profile.marketplace_category = p_category then
    return jsonb_build_object('changed', false, 'replayed', false, 'category', p_category);
  end if;

  update public.tailor_profiles set marketplace_category = p_category where id = p_tailor_profile_id;
  insert into public.marketplace_category_decisions (
    tailor_profile_id, from_category, to_category, reason, actor, idempotency_key
  ) values (p_tailor_profile_id, v_profile.marketplace_category, p_category, v_reason, v_actor, v_key)
  returning * into v_decision;

  insert into public.audit_logs (actor_id, actor_role, event, severity, payload)
  values (v_actor, 'OPS', 'ops.marketplace_category_changed', 'info', jsonb_build_object(
    'tailor_profile_id', p_tailor_profile_id, 'from', v_profile.marketplace_category,
    'to', p_category, 'reason', v_reason, 'idempotency_key', v_key, 'decision_id', v_decision.id));

  return jsonb_build_object('changed', true, 'replayed', false, 'category', p_category, 'decisionId', v_decision.id);
end;
$function$;

revoke all on function public.ops_set_marketplace_category(text, public.marketplace_category, text, text, text)
  from public, anon, authenticated;
grant execute on function public.ops_set_marketplace_category(text, public.marketplace_category, text, text, text)
  to service_role;

-- Restore the approval function body installed by 20261111152000.
create or replace function public.ops_decide_verification(
  p_tailor_user_id uuid,
  p_decision text,
  p_reason text default null,
  p_rejection_code text default null,
  p_placement text default null,
  p_actor text default null
)
returns table (profile_id uuid, status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_profile_id uuid;
  v_display_name text;
  v_from_category public.marketplace_category;
  v_supports_custom boolean;
  v_now timestamptz := now();
  v_status text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_rejection_code text := nullif(upper(btrim(coalesce(p_rejection_code, ''))), '');
  v_placement text := nullif(upper(btrim(coalesce(p_placement, ''))), '');
  v_actor text := left(coalesce(nullif(btrim(coalesce(p_actor, '')), ''), 'ops'), 200);
begin
  if p_decision = 'APPROVE' then
    v_status := 'VERIFIED';
    v_rejection_code := null;
    if v_placement is null then
      raise exception 'PLACEMENT_REQUIRED: Choose an Explore placement (Tailors or Ready-to-wear) before approving.'
        using errcode = '22023';
    end if;
    if v_placement not in ('TAILORING', 'READY_TO_WEAR') then
      raise exception 'PLACEMENT_INVALID: Explore placement must be Tailors or Ready-to-wear.' using errcode = '22023';
    end if;
  elsif p_decision = 'REJECT' then
    v_status := 'REJECTED';
    v_placement := null;
    if v_rejection_code is not null and v_rejection_code not in ('INVALID_PROFILE_IMAGE') then
      raise exception 'Invalid verification rejection code: %', v_rejection_code using errcode = '22023';
    end if;
    if v_rejection_code = 'INVALID_PROFILE_IMAGE' and v_reason is null then
      v_reason := 'Profile Photo Rejected: Please upload a clear headshot or business logo. Landscapes, solid colors, or anonymous placeholders are not permitted.';
    end if;
  else
    raise exception 'Invalid verification decision: %', p_decision using errcode = '22023';
  end if;

  select id::uuid, display_name, marketplace_category, supports_custom_orders
    into v_profile_id, v_display_name, v_from_category, v_supports_custom
  from public.tailor_profiles
  where user_id::text = p_tailor_user_id::text
    and id_verification_status = 'PENDING'
  for update;

  if v_profile_id is null then
    raise exception 'Tailor verification is no longer pending.' using errcode = 'P0001';
  end if;

  if v_placement = 'TAILORING' and coalesce(v_supports_custom, false) = false then
    raise exception 'PLACEMENT_REQUIRES_CUSTOM_ORDERS: This seller does not take custom orders, so it cannot be placed in Tailors.'
      using errcode = '23514';
  end if;

  perform set_config('drape.identity_verification_trusted_write', 'true', true);

  update public.tailor_profiles
  set
    id_verification_status = v_status,
    id_verification_method = 'CHALLENGE_VIDEO',
    is_verified = (p_decision = 'APPROVE'),
    is_live = (p_decision = 'APPROVE'),
    id_verified_at = case when p_decision = 'APPROVE' then coalesce(id_verified_at, v_now) else null end,
    id_verification_rejection_reason = case when p_decision = 'REJECT' then v_reason else null end,
    id_verification_rejected_at = case when p_decision = 'REJECT' then v_now else null end,
    id_verification_metadata = case
      when p_decision = 'REJECT' then coalesce(id_verification_metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'verification_type', 'CHALLENGE_VIDEO',
        'rejection_reason', v_reason,
        'rejection_code', v_rejection_code,
        'rejected_at', v_now,
        'government_id_collected', false,
        'automated_biometrics', false
      ))
      else (coalesce(id_verification_metadata, '{}'::jsonb) - 'rejection_reason' - 'rejection_code' - 'rejected_at') || jsonb_build_object(
        'verification_type', 'CHALLENGE_VIDEO',
        'government_id_collected', false,
        'automated_biometrics', false
      )
    end,
    marketplace_category = case
      when p_decision = 'APPROVE' then v_placement::public.marketplace_category
      else marketplace_category
    end,
    updated_at = v_now
  where id::uuid = v_profile_id;

  if p_decision = 'APPROVE' then
    insert into public.marketplace_category_decisions (
      tailor_profile_id, from_category, to_category, reason, actor, idempotency_key
    ) values (
      v_profile_id::text,
      v_from_category,
      v_placement::public.marketplace_category,
      left('Placed at trust approval' || coalesce(': ' || v_reason, ''), 500),
      v_actor,
      'trust-approval:' || v_profile_id::text || ':' || gen_random_uuid()::text
    );
  end if;

  insert into public.audit_logs (actor_id, actor_role, order_id, event, severity, payload)
  values (
    null,
    'OPS',
    null,
    'tailor.verification_decided',
    case when p_decision = 'APPROVE' then 'info' else 'warn' end,
    jsonb_build_object(
      'tailor_user_id', p_tailor_user_id,
      'tailor_profile_id', v_profile_id,
      'display_name', v_display_name,
      'decision', p_decision,
      'status', v_status,
      'reason', v_reason,
      'rejection_code', v_rejection_code,
      'placement', v_placement,
      'verification_type', 'CHALLENGE_VIDEO',
      'decided_at', v_now
    )
  );

  return query select v_profile_id, v_status;
end;
$function$;

revoke all on function public.ops_decide_verification(uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.ops_decide_verification(uuid, text, text, text, text, text)
  to service_role;

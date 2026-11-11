-- Approving a tailor now also decides where Drapeon shows them. Status, placement,
-- the placement decision row and the audit entry commit together; there is no
-- default placement. REJECT is unchanged and ignores placement.
drop function if exists public.ops_decide_verification(uuid, text, text, text);

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

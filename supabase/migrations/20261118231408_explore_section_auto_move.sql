-- Explore section auto move and approved-seller Ops moves.
-- No data backfill. Works with text profile IDs on Dev and UUID IDs on Production.

do $guard$
declare
  v_profile_id_type text;
  v_decision_id_type text;
begin
  select format_type(a.atttypid, a.atttypmod) into v_profile_id_type
  from pg_attribute a where a.attrelid = 'public.tailor_profiles'::regclass
    and a.attname = 'id' and a.attnum > 0 and not a.attisdropped;
  select format_type(a.atttypid, a.atttypmod) into v_decision_id_type
  from pg_attribute a where a.attrelid = 'public.marketplace_category_decisions'::regclass
    and a.attname = 'tailor_profile_id' and a.attnum > 0 and not a.attisdropped;
  if v_profile_id_type not in ('text', 'uuid') or v_decision_id_type is distinct from v_profile_id_type then
    raise exception 'Unexpected Explore section profile/decision ID shape: %, %', v_profile_id_type, v_decision_id_type;
  end if;
  if to_regclass('public.ops_issues') is null or to_regclass('public.ops_audit_logs') is null
    or to_regclass('public.domain_events') is null or to_regclass('public.job_queue') is null
    or to_regprocedure('public.enqueue_domain_event(text,text,text,jsonb,text,uuid,text,uuid,jsonb,text[],integer,integer,timestamptz)') is null
    or to_regprocedure('public.current_ops_environment()') is null then
    raise exception 'Explore section case or notification prerequisites are missing.';
  end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid
    where t.typname='marketplace_category' and e.enumlabel='READY_TO_WEAR') then
    raise exception 'Explore section enum rename is missing.';
  end if;
end;
$guard$;

create or replace function public.ops_set_marketplace_category(
  p_tailor_profile_id text,
  p_category public.marketplace_category,
  p_reason text,
  p_actor text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_profile public.tailor_profiles%rowtype;
  v_decision public.marketplace_category_decisions%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_actor text := btrim(coalesce(p_actor, ''));
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_profile_id_is_uuid boolean;
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

  select a.atttypid = 'uuid'::regtype
    into v_profile_id_is_uuid
    from pg_attribute a
    where a.attrelid = 'public.tailor_profiles'::regclass
      and a.attname = 'id'
      and a.attnum > 0
      and not a.attisdropped;
  if v_profile_id_is_uuid is null then
    raise exception 'Could not resolve public.tailor_profiles.id type.';
  end if;

  if v_profile_id_is_uuid then
    begin
      perform p_tailor_profile_id::uuid;
    exception when invalid_text_representation then
      raise exception 'Invalid profile ID' using errcode = '22023';
    end;
  end if;

  select * into v_decision from public.marketplace_category_decisions where idempotency_key = v_key;
  if found then
    if v_decision.tailor_profile_id::text <> p_tailor_profile_id or v_decision.to_category <> p_category then
      raise exception 'Idempotency key was already used for a different decision.' using errcode = '23505';
    end if;
    return jsonb_build_object('changed', false, 'replayed', true, 'category', v_decision.to_category, 'decisionId', v_decision.id);
  end if;

  select * into v_profile from public.tailor_profiles where id::text = p_tailor_profile_id for update;
  if not found then raise exception 'Tailor profile not found.' using errcode = 'P0002'; end if;
  if not (v_profile.is_verified is true or v_profile.id_verification_status = 'VERIFIED'
    or v_profile.id_verified_at is not null) then
    raise exception 'Explore section moves require an approved seller.' using errcode = '23514';
  end if;
  if p_category = 'TAILORING'::public.marketplace_category
    and coalesce(v_profile.supports_custom_orders, false) = false then
    raise exception 'PLACEMENT_REQUIRES_CUSTOM_ORDERS: This seller does not take custom orders, so it cannot be placed in Tailors.'
      using errcode = '23514';
  end if;
  if v_profile.marketplace_category = p_category then
    return jsonb_build_object('changed', false, 'replayed', false, 'category', p_category);
  end if;

  update public.tailor_profiles set marketplace_category = p_category where id::text = p_tailor_profile_id;
  if v_profile_id_is_uuid then
    execute 'insert into public.marketplace_category_decisions (
      tailor_profile_id, from_category, to_category, reason, actor, idempotency_key
    ) values ($1::uuid, $2, $3, $4, $5, $6) returning *'
      into v_decision
      using p_tailor_profile_id, v_profile.marketplace_category, p_category, v_reason, v_actor, v_key;
  else
    insert into public.marketplace_category_decisions (
      tailor_profile_id, from_category, to_category, reason, actor, idempotency_key
    ) values (p_tailor_profile_id, v_profile.marketplace_category, p_category, v_reason, v_actor, v_key)
    returning * into v_decision;
  end if;

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

-- The seller may turn custom work off without waiting for Ops. The listing
-- moves in the same row write; the AFTER trigger below records the move.
create or replace function public.guard_tailor_marketplace_category()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_auto_move boolean := false;
begin
  if tg_op = 'UPDATE'
    and (old.is_verified is true or old.id_verification_status = 'VERIFIED' or old.id_verified_at is not null)
    and old.marketplace_category = 'TAILORING'::public.marketplace_category
    and old.supports_custom_orders is true
    and new.supports_custom_orders is false
    and new.marketplace_category = old.marketplace_category then
    new.marketplace_category := 'READY_TO_WEAR'::public.marketplace_category;
    v_auto_move := true;
  end if;

  if current_user not in ('postgres', 'service_role', 'supabase_admin') then
    if tg_op = 'INSERT' and new.marketplace_category is distinct from 'TAILORING'::public.marketplace_category then
      raise exception 'Only Drapeon Ops can assign an Explore section.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.marketplace_category is distinct from old.marketplace_category and not v_auto_move then
      raise exception 'Only Drapeon Ops can change an Explore section.' using errcode = '42501';
    end if;
  end if;

  if tg_op = 'UPDATE'
    and (new.is_verified is true or new.id_verification_status = 'VERIFIED' or new.id_verified_at is not null)
    and new.marketplace_category = 'TAILORING'::public.marketplace_category
    and new.supports_custom_orders is false
    and (new.marketplace_category is distinct from old.marketplace_category
      or new.supports_custom_orders is distinct from old.supports_custom_orders
      or new.is_verified is distinct from old.is_verified) then
    raise exception 'PLACEMENT_REQUIRES_CUSTOM_ORDERS: Tailors requires custom orders.' using errcode = '23514';
  end if;
  return new;
end;
$function$;

-- This trigger is intentionally privileged: client saves can auto-move a
-- listing, but clients cannot insert decision, case, audit, or queue rows.
create or replace function public.record_explore_section_move()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_was_approved boolean;
  v_auto_move boolean;
  v_decision_id uuid;
  v_issue_id uuid;
  v_move_key text;
begin
  if new.marketplace_category is not distinct from old.marketplace_category then return new; end if;
  v_was_approved := old.is_verified is true or old.id_verification_status = 'VERIFIED' or old.id_verified_at is not null;
  -- First placement at trust approval already has its own approval notice.
  if not v_was_approved then return new; end if;
  v_auto_move := old.marketplace_category = 'TAILORING'::public.marketplace_category
    and old.supports_custom_orders is true
    and new.supports_custom_orders is false
    and new.marketplace_category = 'READY_TO_WEAR'::public.marketplace_category;
  -- One key per actual row transition. An idempotent RPC replay or repeated
  -- seller save does not cause another transition, so it cannot add jobs.
  v_move_key := 'explore-section-move:' || gen_random_uuid()::text;

  if v_auto_move then
    insert into public.marketplace_category_decisions
      (tailor_profile_id, from_category, to_category, reason, actor, idempotency_key)
    values (new.id, old.marketplace_category, new.marketplace_category,
      'Custom orders turned off; automatic Explore section move.', 'SYSTEM', v_move_key)
    returning id into v_decision_id;

    insert into public.audit_logs (actor_id, actor_role, event, severity, payload)
    values (null, 'SYSTEM', 'explore_section.auto_moved', 'info',
      jsonb_build_object('tailor_profile_id', new.id::text, 'from', old.marketplace_category,
        'to', new.marketplace_category, 'decision_id', v_decision_id));

    insert into public.ops_issues
      (issue_type, severity, status, canonical_status, source, user_id,
       tailor_profile_id, related_entity_type, related_entity_id, title,
       description, recommended_action, dedupe_key, metadata, queue_key,
       owning_team, priority, environment, provenance)
    values
      ('EXPLORE_SECTION_AUTO_MOVE', 'MEDIUM', 'OPEN', 'NEW', 'tailor_profiles',
       new.user_id::text, new.id::text, 'tailor_profile', new.id::text,
       'Review automatic Explore section move',
       'Custom orders were turned off while this seller was listed in Tailors. The listing moved to Ready-made atomically.',
       'Review the section and seller inventory. Restore Tailors only if custom orders are on.',
       v_move_key, jsonb_build_object('decisionId', v_decision_id),
       'trust-safety', 'trust', 'P2', public.current_ops_environment(),
       case when new.is_test_profile is true then 'QA' else 'REAL' end)
    returning id into v_issue_id;

    insert into public.ops_audit_logs
      (issue_id, action_taken, performed_by, performed_role, reason, after_state)
    values (v_issue_id, 'EXPLORE_SECTION_AUTO_MOVE', 'SYSTEM', 'SYSTEM',
      'Custom orders turned off', jsonb_build_object('category', new.marketplace_category,
        'decisionId', v_decision_id));
  end if;

  -- Payload holds only the public event type and section enum. The worker owns customer
  -- wording in the shared package. Each actual row transition gets one event
  -- and exactly one push and email job, including provider outcomes.
  perform public.enqueue_domain_event(
    p_event_type => 'explore_section_moved',
    p_aggregate_type => 'tailor_profile',
    p_aggregate_id => new.id::text,
    p_idempotency_key => v_move_key,
    p_actor_role => 'SYSTEM',
    p_payload => jsonb_build_object('eventType', 'explore_section_moved',
      'userId', new.user_id::text,
      'exploreSectionMove', new.marketplace_category::text),
    p_metadata => jsonb_build_object('source', case when v_auto_move then 'custom_orders_off' else 'ops' end),
    p_jobs => array['SEND_PUSH', 'SEND_ACCOUNT_EVENT_EMAIL']::text[],
    p_priority => 30,
    p_max_attempts => 8
  );
  return new;
end;
$function$;

revoke all on function public.record_explore_section_move() from public, anon, authenticated;
drop trigger if exists trg_record_explore_section_move on public.tailor_profiles;
create trigger trg_record_explore_section_move
after update of marketplace_category, supports_custom_orders, is_verified on public.tailor_profiles
for each row execute function public.record_explore_section_move();

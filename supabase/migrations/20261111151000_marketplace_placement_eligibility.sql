-- Tailors is the curated custom-order aisle. An approved seller can sit in
-- TAILORING only while it supports custom orders. Pending applicants are not
-- checked: their placement is decided at trust approval.
create or replace function public.guard_tailor_marketplace_category()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') then
    if tg_op = 'INSERT' and new.marketplace_category is distinct from 'TAILORING'::public.marketplace_category then
      raise exception 'Only Drapeon Ops can assign a marketplace category.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.marketplace_category is distinct from old.marketplace_category then
      raise exception 'Only Drapeon Ops can change a marketplace category.' using errcode = '42501';
    end if;
  end if;

  -- Block the save rather than silently moving the seller: placement is an Ops
  -- decision, and a hidden move would change what customers see without a record.
  if tg_op = 'UPDATE'
    and new.is_verified is true
    and new.marketplace_category = 'TAILORING'::public.marketplace_category
    and coalesce(new.supports_custom_orders, false) = false
    and (
      new.marketplace_category is distinct from old.marketplace_category
      or new.supports_custom_orders is distinct from old.supports_custom_orders
      or new.is_verified is distinct from old.is_verified
    ) then
    raise exception 'PLACEMENT_REQUIRES_CUSTOM_ORDERS: This shop is listed in Tailors, which requires custom orders. Ask Drapeon to move it to Ready-to-wear before turning custom orders off.'
      using errcode = '23514';
  end if;
  return new;
end;
$function$;

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

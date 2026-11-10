create type public.marketplace_category as enum ('TAILORING', 'STREETWEAR');

alter table public.tailor_profiles
  add column marketplace_category public.marketplace_category not null default 'TAILORING';

comment on column public.tailor_profiles.marketplace_category is
  'Ops-assigned Explore section. It is independent of seller_type and specialty tags.';

create index tailor_profiles_public_category_rank_idx
  on public.tailor_profiles (marketplace_category, ranking_score desc nulls last, avg_rating desc nulls last)
  where is_live = true and is_verified = true and is_test_profile = false;

create table public.marketplace_category_decisions (
  id uuid primary key default gen_random_uuid(),
  tailor_profile_id text not null references public.tailor_profiles(id) on delete cascade,
  from_category public.marketplace_category not null,
  to_category public.marketplace_category not null,
  reason text not null check (char_length(reason) between 12 and 500),
  actor text not null,
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 200),
  created_at timestamptz not null default now()
);

alter table public.marketplace_category_decisions enable row level security;
grant select on public.marketplace_category_decisions to service_role;

create or replace function public.guard_tailor_marketplace_category()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') then
    if tg_op = 'INSERT' and new.marketplace_category is distinct from 'TAILORING'::public.marketplace_category then
      raise exception 'Only Drapeon Ops can assign a marketplace category.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.marketplace_category is distinct from old.marketplace_category then
      raise exception 'Only Drapeon Ops can change a marketplace category.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_guard_tailor_marketplace_category
before insert or update of marketplace_category on public.tailor_profiles
for each row execute function public.guard_tailor_marketplace_category();

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
as $$
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
$$;

revoke all on function public.guard_tailor_marketplace_category() from public;
revoke all on function public.ops_set_marketplace_category(text, public.marketplace_category, text, text, text) from public, anon, authenticated;
grant execute on function public.guard_tailor_marketplace_category() to service_role;
grant execute on function public.ops_set_marketplace_category(text, public.marketplace_category, text, text, text) to service_role;
grant select (marketplace_category) on public.tailor_profiles to anon, authenticated;

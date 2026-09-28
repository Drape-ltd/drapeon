-- Topic-level marketing choices stay in Drapeon's consent control plane.
-- Provider topic IDs are mappings, never the source of truth for consent.

create table public.communication_marketing_topic_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  topic_key text not null check (topic_key in ('DRAPEON_STORIES','NEW_TAILOR_DROPS','READY_MADE_EDITS','LAUNCH_EVENTS')),
  channel text not null check (channel in ('EMAIL','PUSH')),
  enabled boolean not null default false,
  source text not null default 'ACCOUNT_SETTINGS' check (source in ('ACCOUNT_SETTINGS','ONBOARDING','CAMPAIGN','OPS','SYSTEM')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, topic_key, channel)
);

create index communication_marketing_topic_preferences_user_idx
  on public.communication_marketing_topic_preferences (user_id, channel, topic_key);

create trigger communication_marketing_topic_preferences_touch
before update on public.communication_marketing_topic_preferences
for each row execute function public.touch_communication_row_updated_at();

alter table public.communication_marketing_topic_preferences enable row level security;
revoke all on public.communication_marketing_topic_preferences from anon, authenticated;
grant select on public.communication_marketing_topic_preferences to authenticated;
grant all on public.communication_marketing_topic_preferences to service_role;

create policy communication_marketing_topic_preferences_own_read
on public.communication_marketing_topic_preferences
for select to authenticated using (user_id = auth.uid());

create or replace function public.set_my_marketing_topic_preference(
  p_topic_key text,
  p_channel text,
  p_enabled boolean,
  p_source text default 'ACCOUNT_SETTINGS'
) returns public.communication_marketing_topic_preferences
language plpgsql security definer set search_path = public, auth as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_consented boolean := false;
  v_row public.communication_marketing_topic_preferences;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_topic_key not in ('DRAPEON_STORIES','NEW_TAILOR_DROPS','READY_MADE_EDITS','LAUNCH_EVENTS') then
    raise exception 'INVALID_MARKETING_TOPIC';
  end if;
  if p_channel not in ('EMAIL','PUSH') then raise exception 'INVALID_MARKETING_CHANNEL'; end if;
  if p_source not in ('ACCOUNT_SETTINGS','ONBOARDING','CAMPAIGN','OPS','SYSTEM') then
    raise exception 'INVALID_MARKETING_SOURCE';
  end if;

  select role::text into v_role from public.users where id = v_user;
  if v_role is null then raise exception 'PROFILE_NOT_READY'; end if;
  if p_topic_key = 'DRAPEON_STORIES' and p_channel <> 'EMAIL' then raise exception 'MARKETING_TOPIC_NOT_AVAILABLE'; end if;
  if p_topic_key in ('NEW_TAILOR_DROPS','READY_MADE_EDITS') and v_role <> 'CUSTOMER' then raise exception 'MARKETING_TOPIC_NOT_AVAILABLE'; end if;
  if p_topic_key in ('DRAPEON_STORIES','LAUNCH_EVENTS') and v_role not in ('CUSTOMER','TAILOR') then raise exception 'MARKETING_TOPIC_NOT_AVAILABLE'; end if;

  if p_enabled then
    select coalesce((
      select status = 'GRANTED'
      from public.communication_consents
      where user_id = v_user and purpose = 'MARKETING' and channel = p_channel
      order by created_at desc limit 1
    ), false) into v_consented;
    if not v_consented then raise exception 'MARKETING_CONSENT_REQUIRED'; end if;
  end if;

  insert into public.communication_marketing_topic_preferences(user_id, topic_key, channel, enabled, source)
  values (v_user, p_topic_key, p_channel, p_enabled, p_source)
  on conflict (user_id, topic_key, channel) do update
    set enabled = excluded.enabled, source = excluded.source, updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.set_my_marketing_topic_preference(text,text,boolean,text) from public;
grant execute on function public.set_my_marketing_topic_preference(text,text,boolean,text) to authenticated;

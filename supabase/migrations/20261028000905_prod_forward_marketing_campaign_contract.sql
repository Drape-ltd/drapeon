-- Forward-only recovery of the final marketing campaign contract. No campaign rows are rewritten.
alter table public.communication_campaigns add column if not exists marketing_topic_key text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'communication_campaigns_marketing_topic_key_check'
    and conrelid = 'public.communication_campaigns'::regclass) then
    alter table public.communication_campaigns add constraint communication_campaigns_marketing_topic_key_check
      check (marketing_topic_key is null or marketing_topic_key in ('DRAPEON_STORIES','NEW_TAILOR_DROPS','READY_MADE_EDITS','LAUNCH_EVENTS'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'communication_campaigns_marketing_topic_purpose_check'
    and conrelid = 'public.communication_campaigns'::regclass) then
    alter table public.communication_campaigns add constraint communication_campaigns_marketing_topic_purpose_check
      check (marketing_topic_key is null or purpose = 'MARKETING');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'communication_campaigns_marketing_topic_category_check'
    and conrelid = 'public.communication_campaigns'::regclass) then
    alter table public.communication_campaigns add constraint communication_campaigns_marketing_topic_category_check
      check (marketing_topic_key is null or category in ('PROMOTION','PRODUCT_UPDATE'));
  end if;
end;
$$;

create index if not exists communication_campaigns_marketing_topic_idx
  on public.communication_campaigns (marketing_topic_key, status)
  where marketing_topic_key is not null;

create or replace function public.marketing_topic_provider_alias(p_topic_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_topic_key
    when 'DRAPEON_STORIES' then 'drapeon-stories'
    when 'NEW_TAILOR_DROPS' then 'new-tailor-drops'
    when 'READY_MADE_EDITS' then 'ready-made-edits'
    when 'LAUNCH_EVENTS' then 'launch-events'
    else null
  end;
$$;

create or replace function public.marketing_topic_channel_allowed(
  p_topic_key text,
  p_role text,
  p_channel text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_topic_key
    when 'DRAPEON_STORIES' then p_role in ('CUSTOMER','TAILOR') and p_channel = 'EMAIL'
    when 'NEW_TAILOR_DROPS' then p_role = 'CUSTOMER' and p_channel in ('EMAIL','PUSH')
    when 'READY_MADE_EDITS' then p_role = 'CUSTOMER' and p_channel in ('EMAIL','PUSH')
    when 'LAUNCH_EVENTS' then p_role in ('CUSTOMER','TAILOR') and p_channel in ('EMAIL','PUSH')
    else false
  end;
$$;

create or replace function public.apply_marketing_topic_recipient_contract()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_topic_key text;
  v_topic_alias text;
  v_role text;
  v_channel text;
  v_allowed_channels text[] := array['IN_APP']::text[];
  v_enabled boolean;
  v_consented boolean;
begin
  select marketing_topic_key into v_topic_key
  from public.communication_campaigns
  where id = new.campaign_id;

  if v_topic_key is null then return new; end if;

  v_topic_alias := public.marketing_topic_provider_alias(v_topic_key);
  select upper(role::text) into v_role
  from public.users
  where id = new.user_id;

  foreach v_channel in array coalesce(new.channels, array['IN_APP']::text[]) loop
    if v_channel = 'IN_APP' then continue; end if;
    if not public.marketing_topic_channel_allowed(v_topic_key, v_role, v_channel) then continue; end if;

    select enabled into v_enabled
    from public.communication_marketing_topic_preferences
    where user_id = new.user_id
      and topic_key = v_topic_key
      and channel = v_channel;

    select coalesce((
      select status = 'GRANTED'
      from public.communication_consents
      where user_id = new.user_id and purpose = 'MARKETING' and channel = v_channel
      order by created_at desc limit 1
    ), false) into v_consented;

    if coalesce(v_enabled, false) and v_consented then
      v_allowed_channels := array_append(v_allowed_channels, v_channel);
    end if;
  end loop;

  new.channels := v_allowed_channels;
  new.audience_snapshot := coalesce(new.audience_snapshot, '{}'::jsonb) || jsonb_build_object(
    'marketing_topic_key', v_topic_key,
    'provider_topic_alias', v_topic_alias
  );
  new.consent_snapshot := coalesce(new.consent_snapshot, '{}'::jsonb) || jsonb_build_object(
    'topic_key', v_topic_key,
    'topic_channel_preferences_captured_at', now()
  );
  return new;
end;
$$;

create or replace function public.ops_set_communication_campaign_topic(
  p_campaign_id uuid,
  p_topic_key text
)
returns public.communication_campaigns
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.communication_campaigns;
begin
  perform public.require_communications_service_role();
  if p_topic_key is not null and p_topic_key not in ('DRAPEON_STORIES','NEW_TAILOR_DROPS','READY_MADE_EDITS','LAUNCH_EVENTS') then
    raise exception 'Invalid marketing topic';
  end if;

  select * into v_campaign
  from public.communication_campaigns
  where id = p_campaign_id
  for update;
  if v_campaign.id is null then raise exception 'Campaign not found'; end if;
  if v_campaign.status not in ('DRAFT','PENDING_APPROVAL') then
    raise exception 'Campaign topic cannot change after approval begins';
  end if;
  if p_topic_key is not null and v_campaign.purpose <> 'MARKETING' then
    raise exception 'Marketing topics require MARKETING purpose';
  end if;

  update public.communication_campaigns
  set marketing_topic_key = p_topic_key
  where id = p_campaign_id
  returning * into v_campaign;
  return v_campaign;
end;
$$;

create or replace function public.validate_marketing_campaign_audience()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_ids jsonb := coalesce(new.audience_definition->'user_ids', '[]'::jsonb);
  v_roles jsonb := coalesce(new.audience_definition->'roles', '[]'::jsonb);
begin
  if new.marketing_topic_key = 'NEW_TAILOR_DROPS' then
    if jsonb_typeof(v_user_ids) <> 'array' or jsonb_array_length(v_user_ids) = 0 then
      raise exception 'New tailor drops require an explicit customer user_ids audience';
    end if;
    if jsonb_typeof(v_roles) <> 'array' or jsonb_array_length(v_roles) > 0 then
      raise exception 'New tailor drops cannot include a role-wide audience';
    end if;
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'communication_campaign_recipient_topic_contract'
    and tgrelid = 'public.communication_campaign_recipients'::regclass) then
    create trigger communication_campaign_recipient_topic_contract
      before insert on public.communication_campaign_recipients
      for each row execute function public.apply_marketing_topic_recipient_contract();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'communication_campaign_new_tailor_audience_guard'
    and tgrelid = 'public.communication_campaigns'::regclass) then
    create trigger communication_campaign_new_tailor_audience_guard
      before insert or update of marketing_topic_key, audience_definition
      on public.communication_campaigns
      for each row execute function public.validate_marketing_campaign_audience();
  end if;
end;
$$;

revoke all on function public.marketing_topic_provider_alias(text) from public, anon, authenticated;
revoke all on function public.marketing_topic_channel_allowed(text,text,text) from public, anon, authenticated;
revoke all on function public.apply_marketing_topic_recipient_contract() from public, anon, authenticated;
revoke all on function public.ops_set_communication_campaign_topic(uuid,text) from public, anon, authenticated;
revoke all on function public.validate_marketing_campaign_audience() from public, anon, authenticated;
grant execute on function public.ops_set_communication_campaign_topic(uuid,text) to service_role;

-- Marketing recipient eligibility must use Drapeon's canonical account role.
-- Auth metadata can be stale or absent; unknown accounts must fail closed.

create or replace function public.apply_marketing_topic_recipient_contract()
returns trigger
language plpgsql
security definer
set search_path = public
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

revoke all on function public.apply_marketing_topic_recipient_contract() from public, anon, authenticated;

-- New-tailor marketing is curated or matched, never a role-wide broadcast.
-- Consent and channel filtering still happen in the recipient contract; this
-- guard only prevents an unsafe audience definition from being approved.

create or replace function public.validate_marketing_campaign_audience()
returns trigger
language plpgsql
security definer
set search_path = public
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

drop trigger if exists communication_campaign_new_tailor_audience_guard
  on public.communication_campaigns;
create trigger communication_campaign_new_tailor_audience_guard
before insert or update of marketing_topic_key, audience_definition
on public.communication_campaigns
for each row execute function public.validate_marketing_campaign_audience();

revoke all on function public.validate_marketing_campaign_audience() from public, anon, authenticated;

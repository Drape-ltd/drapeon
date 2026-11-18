-- Forward repair step three. Token provenance and quarantine run only after
-- the schema in 20261118023004 exists. These functions change no existing
-- token until a new registration or three definite device-token failures.

create or replace function public.reset_push_quarantine_on_token_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.token is distinct from old.token then
    new.token_generation_started_at := now();
    new.expo_project_id := null;
    new.app_variant := null;
    new.application_id := null;
    new.apns_environment := null;
    new.quarantined_at := null;
    new.quarantine_reason := null;
  end if;
  return new;
end;
$$;

drop trigger if exists push_tokens_reset_quarantine_on_token_change
  on public.push_tokens;
create trigger push_tokens_reset_quarantine_on_token_change
before update of token on public.push_tokens
for each row execute function public.reset_push_quarantine_on_token_change();

revoke all on function public.reset_push_quarantine_on_token_change()
  from public, anon, authenticated;

create or replace function public.register_push_token_with_provenance(
  p_token text,
  p_platform text,
  p_device_id text,
  p_expo_project_id text,
  p_app_variant text,
  p_application_id text,
  p_apns_environment text
)
returns public.push_tokens
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.push_tokens;
begin
  if p_expo_project_id is null or p_expo_project_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or p_app_variant is null or p_app_variant not in ('development', 'preview', 'testflight', 'production')
     or p_application_id is null or length(btrim(p_application_id)) < 3
     or length(p_application_id) > 200
     or (p_platform = 'ios' and p_apns_environment not in ('development', 'production') and p_apns_environment is not null)
     or (p_platform = 'android' and p_apns_environment is not null) then
    raise exception 'Invalid push token provenance.' using errcode = '22023';
  end if;

  v_row := public.register_push_token(p_token, p_platform, p_device_id);
  update public.push_tokens
     set expo_project_id = p_expo_project_id,
         app_variant = p_app_variant,
         application_id = btrim(p_application_id),
         apns_environment = p_apns_environment
   where id = v_row.id
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.register_push_token_with_provenance(text,text,text,text,text,text,text)
  from public, anon;
grant execute on function public.register_push_token_with_provenance(text,text,text,text,text,text,text)
  to authenticated, service_role;

create or replace function public.quarantine_repeated_bad_device_token(p_push_token_id text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_failure_count integer;
  v_changed integer;
  v_generation_started_at timestamptz;
begin
  if p_push_token_id is null or btrim(p_push_token_id) = '' then return false; end if;
  select token_generation_started_at into v_generation_started_at
    from public.push_tokens where id::text = p_push_token_id for update;
  if v_generation_started_at is null then return false; end if;
  select count(*) into v_failure_count
    from public.push_delivery_attempts attempt
   where attempt.push_token_id::text = p_push_token_id
     and attempt.created_at >= v_generation_started_at
     and attempt.status = 'DELIVERY_ERROR'
     and (
       attempt.error_code = 'BadDeviceToken'
       or (attempt.error_code = 'DeveloperError' and attempt.error_message ilike '%BadDeviceToken%')
     );
  if v_failure_count < 3 then return false; end if;

  update public.push_tokens
     set quarantined_at = now(), quarantine_reason = 'BAD_DEVICE_TOKEN_REPEATED'
   where id::text = p_push_token_id and quarantined_at is null;
  get diagnostics v_changed = row_count;
  return v_changed = 1;
end;
$$;

revoke all on function public.quarantine_repeated_bad_device_token(text)
  from public, anon, authenticated;
grant execute on function public.quarantine_repeated_bad_device_token(text)
  to service_role;

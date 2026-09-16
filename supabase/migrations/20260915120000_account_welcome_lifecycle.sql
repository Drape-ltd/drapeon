-- Drapeon account welcome lifecycle.
--
-- Auth remains the source of truth for account creation. This trigger only
-- records idempotent delivery work in the existing domain-event/job queue;
-- it never sends email synchronously and never blocks signup on Resend.

create or replace function public.enqueue_welcome_after_user_created()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_role text;
  v_signup_method text;
  v_entry_surface text;
  v_recipient_name text;
  v_user_id text := new.id::text;
begin
  v_role := upper(trim(coalesce(new.raw_user_meta_data->>'role', 'CUSTOMER')));
  if v_role not in ('CUSTOMER', 'TAILOR') then
    v_role := 'CUSTOMER';
  end if;

  v_signup_method := lower(trim(coalesce(
    new.raw_app_meta_data->>'provider',
    new.raw_user_meta_data->>'signup_method',
    'email'
  )));
  if v_signup_method not in ('email', 'apple', 'google') then
    v_signup_method := 'other';
  end if;

  v_entry_surface := lower(trim(coalesce(
    new.raw_user_meta_data->>'entry_surface',
    'unknown'
  )));
  if v_entry_surface = '' then
    v_entry_surface := 'unknown';
  end if;

  v_recipient_name := left(
    regexp_replace(
      coalesce(
        nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
        nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
        nullif(trim(new.raw_user_meta_data->>'name'), ''),
        split_part(coalesce(new.email, v_user_id), '@', 1)
      ),
      '\s+',
      ' ',
      'g'
    ),
    120
  );

  perform public.enqueue_domain_event(
    p_event_type => 'account_created',
    p_aggregate_type => 'user',
    p_aggregate_id => v_user_id,
    -- Keep the queue key aligned with lifecycle-welcome.ts so retries of an
    -- Auth callback, webhook, or worker claim cannot enqueue a second welcome.
    p_idempotency_key => 'welcome:' || lower(v_role) || ':' || v_user_id || ':welcome',
    p_actor_id => new.id,
    p_actor_role => 'SYSTEM',
    p_payload => jsonb_build_object(
      'userId', v_user_id,
      'welcomeRole', v_role,
      'welcomeStep', 'WELCOME',
      'recipientName', v_recipient_name,
      'signup_method', v_signup_method,
      'entry_surface', v_entry_surface
    ),
    p_metadata => jsonb_build_object(
      'source', 'auth.users',
      'contract_version', 1
    ),
    p_jobs => array['SEND_ACCOUNT_EVENT_EMAIL']::text[],
    p_priority => 20,
    p_max_attempts => 8,
    p_run_at => now()
  );

  perform public.enqueue_domain_event(
    p_event_type => 'account_welcome_next_step_scheduled',
    p_aggregate_type => 'user',
    p_aggregate_id => v_user_id,
    p_idempotency_key => 'welcome:' || lower(v_role) || ':' || v_user_id || ':next_step',
    p_actor_id => new.id,
    p_actor_role => 'SYSTEM',
    p_payload => jsonb_build_object(
      'userId', v_user_id,
      'welcomeRole', v_role,
      'welcomeStep', 'NEXT_STEP',
      'recipientName', v_recipient_name
    ),
    p_metadata => jsonb_build_object(
      'source', 'account_created',
      'contract_version', 1
    ),
    p_jobs => array['SEND_ACCOUNT_EVENT_EMAIL']::text[],
    p_priority => 60,
    p_max_attempts => 8,
    p_run_at => now() + interval '48 hours'
  );

  return new;
exception when others then
  -- Welcome delivery is a side effect. A queue/provider problem must not
  -- make Auth reject an otherwise valid account creation.
  raise warning 'Drapeon welcome enqueue failed for user %: %', v_user_id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists on_auth_user_welcome_created on auth.users;
create trigger on_auth_user_welcome_created
  after insert on auth.users
  for each row execute function public.enqueue_welcome_after_user_created();

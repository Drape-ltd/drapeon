-- Only Drapeon's canonical account role can authorize survey eligibility.
create or replace function public.enqueue_survey_invite(
  p_kind text,
  p_subject_type text,
  p_subject_id text,
  p_user_id uuid,
  p_channel text default 'EMAIL',
  p_available_at timestamptz default now(),
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_kind text := upper(trim(coalesce(p_kind, '')));
  v_subject_type text := upper(trim(coalesce(p_subject_type, '')));
  v_subject_id text := trim(coalesce(p_subject_id, ''));
  v_channel text := upper(trim(coalesce(p_channel, 'EMAIL')));
  v_role text;
  v_key text;
  v_available_at timestamptz := coalesce(p_available_at, now());
  v_invite_id uuid;
begin
  if v_kind not in (
    'CUSTOMER_POST_COMPLETION_CSAT',
    'SUPPORT_RESOLUTION_CSAT',
    'TAILOR_FIRST_ORDER_CSAT',
    'ONBOARDING_PULSE'
  ) then
    raise exception 'Unsupported survey kind.' using errcode = '22023';
  end if;
  if v_subject_type not in ('ORDER', 'SUPPORT_CASE', 'ACCOUNT') then
    raise exception 'Unsupported survey subject type.' using errcode = '22023';
  end if;
  if v_subject_id = '' or char_length(v_subject_id) > 120 then
    raise exception 'Survey subject id is invalid.' using errcode = '22023';
  end if;
  if v_channel not in ('WEB', 'IOS', 'ANDROID', 'EMAIL') then
    raise exception 'Unsupported survey invite channel.' using errcode = '22023';
  end if;
  if p_user_id is null then
    return null;
  end if;

  select upper(u.role::text) into v_role
  from public.users u
  where u.id = p_user_id;

  if v_role not in ('CUSTOMER', 'TAILOR') then
    return null;
  end if;
  if v_kind = 'CUSTOMER_POST_COMPLETION_CSAT'
    and (v_subject_type <> 'ORDER' or v_role <> 'CUSTOMER') then
    return null;
  end if;
  if v_kind = 'TAILOR_FIRST_ORDER_CSAT'
    and (v_subject_type <> 'ORDER' or v_role <> 'TAILOR') then
    return null;
  end if;
  if v_kind = 'SUPPORT_RESOLUTION_CSAT' and v_subject_type <> 'SUPPORT_CASE' then
    return null;
  end if;
  if v_kind = 'ONBOARDING_PULSE' and v_subject_type <> 'ACCOUNT' then
    return null;
  end if;

  -- A response is terminal for this subject. Do not leave a stale invite that
  -- could be delivered after a user has already completed the survey.
  if exists (
    select 1
    from public.survey_responses sr
    where sr.user_id = p_user_id
      and sr.kind = v_kind
      and sr.version = 1
      and sr.subject_type = v_subject_type
      and sr.subject_id = v_subject_id
  ) then
    return null;
  end if;

  v_key := 'survey-invite:' || lower(v_kind) || ':' || p_user_id::text || ':'
    || lower(v_subject_type) || ':' || v_subject_id || ':v1';

  insert into public.survey_invites (
    kind,
    version,
    subject_type,
    subject_id,
    user_id,
    role,
    channel,
    status,
    available_at,
    expires_at,
    idempotency_key,
    metadata
  ) values (
    v_kind,
    1,
    v_subject_type,
    v_subject_id,
    p_user_id,
    v_role,
    v_channel,
    'PENDING',
    v_available_at,
    v_available_at + interval '30 days',
    v_key,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (idempotency_key) do nothing
  returning id into v_invite_id;

  if v_invite_id is null then
    select id into v_invite_id
    from public.survey_invites
    where idempotency_key = v_key;
  end if;
  return v_invite_id;
exception when others then
  -- Feedback scheduling is a side effect. A schema/provider hiccup must never
  -- make an order, support, or payout transition fail.
  raise warning 'Drapeon survey invite enqueue failed for %/%: %', v_kind, v_subject_id, sqlerrm;
  return null;
end;
$$;

revoke all on function public.enqueue_survey_invite(text,text,text,uuid,text,timestamptz,jsonb)
  from public, anon, authenticated;
grant execute on function public.enqueue_survey_invite(text,text,text,uuid,text,timestamptz,jsonb)
  to service_role;

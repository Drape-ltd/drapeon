-- Development-only, real Supabase AAL2 identity receipts for Money Desk QA.
-- Runtime gating remains in the Ops application; these database controls make
-- the authenticated principal and two-person rule authoritative even when the
-- caller holds the service role used by the local application.

alter table public.ops_workforce_principals
  add column if not exists auth_user_id uuid references auth.users(id) on delete restrict;

create unique index if not exists ops_workforce_principals_auth_user_unique
  on public.ops_workforce_principals(auth_user_id)
  where auth_user_id is not null;

create or replace function public.is_dev_ops_mfa_environment()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(
    select 1 from public.ops_runtime_configuration
    where singleton=true and environment='DEVELOPMENT' and project_ref='pqptfuqogvrajozfsqzi'
  );
$$;

create or replace function public.bind_dev_ops_mfa_principal(p_auth_user_id uuid)
returns uuid language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare v_email text; v_principal_id uuid;
begin
  if not public.is_dev_ops_mfa_environment() then raise exception 'Local Supabase MFA is disabled outside the bound Dev project.'; end if;
  select lower(email) into v_email from auth.users where id=p_auth_user_id and email_confirmed_at is not null;
  if v_email not in ('founders@drapeon.co','founders+ops-qa@drapeon.co') then raise exception 'Auth user is not an approved Dev QA principal.'; end if;
  update public.ops_workforce_principals set auth_user_id=p_auth_user_id,updated_at=now()
  where email=v_email and status='ACTIVE' and 'development'=any(permitted_environments)
    and (auth_user_id is null or auth_user_id=p_auth_user_id)
  returning id into v_principal_id;
  if v_principal_id is null then raise exception 'Dev QA workforce principal is unavailable or already bound.'; end if;
  return v_principal_id;
end $$;

revoke all on function public.bind_dev_ops_mfa_principal(uuid) from public,anon,authenticated;
grant execute on function public.bind_dev_ops_mfa_principal(uuid) to service_role;
revoke all on function public.is_dev_ops_mfa_environment() from public,anon,authenticated;
grant execute on function public.is_dev_ops_mfa_environment() to service_role;

alter table public.money_desk_jit_grants
  drop constraint if exists money_desk_jit_grants_assurance_source_check;
alter table public.money_desk_jit_grants
  add constraint money_desk_jit_grants_assurance_source_check
  check (assurance_source in ('CLOUDFLARE_ACCESS','MIGRATION_DRY_RUN','SUPABASE_MFA_LOCAL'));
alter table public.money_desk_jit_grants
  add column if not exists workforce_principal_id uuid references public.ops_workforce_principals(id) on delete restrict,
  add column if not exists auth_user_id uuid references auth.users(id) on delete restrict,
  add column if not exists aal text,
  add column if not exists mfa_authenticated_at timestamptz;

alter table public.money_desk_requests
  add column if not exists requester_principal_id uuid references public.ops_workforce_principals(id) on delete restrict,
  add column if not exists requester_auth_user_id uuid references auth.users(id) on delete restrict,
  add column if not exists requester_aal text,
  add column if not exists requester_mfa_at timestamptz,
  add column if not exists requester_assurance_source text;

alter table public.money_desk_decisions
  add column if not exists approver_principal_id uuid references public.ops_workforce_principals(id) on delete restrict,
  add column if not exists approver_auth_user_id uuid references auth.users(id) on delete restrict,
  add column if not exists approver_aal text,
  add column if not exists approver_mfa_at timestamptz,
  add column if not exists approver_assurance_source text;

create unique index if not exists money_desk_decisions_request_principal_unique
  on public.money_desk_decisions(request_id, approver_principal_id)
  where approver_principal_id is not null;

create or replace function public.guard_local_mfa_environment()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.assurance_source='SUPABASE_MFA_LOCAL' and not public.is_dev_ops_mfa_environment() then
    raise exception 'SUPABASE_MFA_LOCAL is disabled outside the bound Dev project.';
  end if;
  return new;
end $$;

drop trigger if exists guard_local_mfa_environment on public.money_desk_jit_grants;
create trigger guard_local_mfa_environment before insert or update on public.money_desk_jit_grants
for each row execute function public.guard_local_mfa_environment();

create or replace function public.protect_local_mfa_identity_receipt()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_table_name='money_desk_jit_grants' and (
    new.workforce_principal_id is distinct from old.workforce_principal_id or new.auth_user_id is distinct from old.auth_user_id
    or new.aal is distinct from old.aal or new.mfa_authenticated_at is distinct from old.mfa_authenticated_at
    or new.assurance_source is distinct from old.assurance_source) then raise exception 'Money Desk MFA identity receipt is immutable.';
  elsif tg_table_name='money_desk_requests' and (
    new.requester_principal_id is distinct from old.requester_principal_id or new.requester_auth_user_id is distinct from old.requester_auth_user_id
    or new.requester_aal is distinct from old.requester_aal or new.requester_mfa_at is distinct from old.requester_mfa_at
    or new.requester_assurance_source is distinct from old.requester_assurance_source) then raise exception 'Money Desk requester identity receipt is immutable.';
  end if;
  return new;
end $$;

drop trigger if exists protect_local_mfa_grant_receipt on public.money_desk_jit_grants;
create trigger protect_local_mfa_grant_receipt before update on public.money_desk_jit_grants for each row execute function public.protect_local_mfa_identity_receipt();
drop trigger if exists protect_local_mfa_request_receipt on public.money_desk_requests;
create trigger protect_local_mfa_request_receipt before update on public.money_desk_requests for each row execute function public.protect_local_mfa_identity_receipt();

create or replace function public.issue_local_supabase_mfa_money_desk_grant(
  p_principal_id uuid, p_auth_user_id uuid, p_aal text, p_mfa_at timestamptz,
  p_action_scopes text[], p_reason text, p_correlation_id uuid default gen_random_uuid()
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_principal public.ops_workforce_principals%rowtype; v_grant public.money_desk_jit_grants%rowtype;
begin
  if not public.is_dev_ops_mfa_environment() then raise exception 'Local Supabase MFA is disabled outside the bound Dev project.'; end if;
  select * into v_principal from public.ops_workforce_principals where id=p_principal_id for share;
  if v_principal.id is null or v_principal.auth_user_id is distinct from p_auth_user_id then raise exception 'Workforce principal is not bound to this Auth user.'; end if;
  if v_principal.status <> 'ACTIVE' or not ('development'=any(v_principal.permitted_environments))
    or v_principal.access_review_due_at is null or v_principal.access_review_due_at <= now() then raise exception 'Workforce principal is not active for development.'; end if;
  if p_aal <> 'aal2' or p_mfa_at is null or p_mfa_at > now()+interval '30 seconds' or p_mfa_at < now()-interval '15 minutes' then raise exception 'Fresh AAL2 MFA is required.'; end if;
  if not (v_principal.roles && array['ops','customer_success','finance','admin']) then raise exception 'This principal cannot request Money Desk elevation.'; end if;
  if cardinality(p_action_scopes) is null or cardinality(p_action_scopes)=0 then raise exception 'Choose at least one Money Desk action scope.'; end if;
  if char_length(trim(coalesce(p_reason,''))) not between 12 and 500 then raise exception 'Elevation reason must be 12 to 500 characters.'; end if;
  insert into public.money_desk_jit_grants(actor_email,actor_subject,actor_role,assurance_source,authentication_methods,action_scopes,reason,expires_at,correlation_id,workforce_principal_id,auth_user_id,aal,mfa_authenticated_at)
  values(v_principal.email,'supabase:'||p_auth_user_id,
    case when 'admin'=any(v_principal.roles) then 'ADMIN' when 'finance'=any(v_principal.roles) then 'FINANCE' when 'customer_success'=any(v_principal.roles) then 'CUSTOMER_SUCCESS' else 'OPS' end,
    'SUPABASE_MFA_LOCAL',array['totp'],p_action_scopes,trim(p_reason),least(now()+interval '15 minutes',p_mfa_at+interval '15 minutes'),p_correlation_id,p_principal_id,p_auth_user_id,p_aal,p_mfa_at)
  returning * into v_grant;
  return jsonb_build_object('grantId',v_grant.id,'expiresAt',v_grant.expires_at,'correlationId',v_grant.correlation_id);
end $$;

create or replace function public.apply_local_supabase_mfa_money_desk_policy()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_grant public.money_desk_jit_grants%rowtype;
begin
  if not public.is_dev_ops_mfa_environment() then return new; end if;
  select * into v_grant from public.money_desk_jit_grants where id=new.requester_jit_grant_id;
  if v_grant.assurance_source is distinct from 'SUPABASE_MFA_LOCAL' then return new; end if;
  if v_grant.workforce_principal_id is null or v_grant.auth_user_id is null or v_grant.aal <> 'aal2' or v_grant.mfa_authenticated_at < now()-interval '15 minutes' then raise exception 'Verified local MFA identity receipt is required.'; end if;
  new.requester_principal_id:=v_grant.workforce_principal_id; new.requester_auth_user_id:=v_grant.auth_user_id;
  new.requester_aal:=v_grant.aal; new.requester_mfa_at:=v_grant.mfa_authenticated_at; new.requester_assurance_source:=v_grant.assurance_source;
  new.required_approval_count:=2; new.risk_level:='HIGH';
  new.risk_reasons:=array_append(array_remove(new.risk_reasons,'FOUNDER_APPROVAL_REQUIRED'),'DEV_SUPABASE_MFA_TWO_PERSON');
  new.policy_version:='dev-supabase-mfa-two-person-v1';
  return new;
end $$;

drop trigger if exists zz_apply_local_supabase_mfa_money_desk_policy on public.money_desk_requests;
create trigger zz_apply_local_supabase_mfa_money_desk_policy before insert on public.money_desk_requests
for each row execute function public.apply_local_supabase_mfa_money_desk_policy();

create or replace function public.decide_local_supabase_mfa_money_desk_request(
  p_request_id uuid,p_jit_grant_id uuid,p_principal_id uuid,p_auth_user_id uuid,
  p_aal text,p_mfa_at timestamptz,p_decision text,p_reason text
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_request public.money_desk_requests%rowtype; v_principal public.ops_workforce_principals%rowtype; v_grant public.money_desk_jit_grants%rowtype; v_count integer;
begin
  if not public.is_dev_ops_mfa_environment() then raise exception 'Local Supabase MFA is disabled outside the bound Dev project.'; end if;
  select * into v_request from public.money_desk_requests where id=p_request_id for update;
  if v_request.id is null or v_request.status <> 'PENDING_APPROVAL' then raise exception 'Money Desk request is not pending approval.'; end if;
  if v_request.requester_assurance_source is distinct from 'SUPABASE_MFA_LOCAL' then raise exception 'Only a local Supabase MFA request can use this decision path.'; end if;
  select * into v_principal from public.ops_workforce_principals where id=p_principal_id for share;
  select * into v_grant from public.money_desk_jit_grants where id=p_jit_grant_id for share;
  if v_principal.id is null or v_principal.auth_user_id is distinct from p_auth_user_id or v_principal.status <> 'ACTIVE'
    or not ('development'=any(v_principal.permitted_environments)) or v_principal.access_review_due_at <= now()
    or not (v_principal.roles && array['finance','admin']) then raise exception 'Active Finance or Admin principal is required.'; end if;
  if v_grant.workforce_principal_id is distinct from p_principal_id or v_grant.auth_user_id is distinct from p_auth_user_id
    or v_grant.assurance_source <> 'SUPABASE_MFA_LOCAL' or v_grant.expires_at <= now() or not (v_request.action_type=any(v_grant.action_scopes)) then raise exception 'MFA grant does not belong to this principal or action.'; end if;
  if p_aal <> 'aal2' or p_mfa_at < now()-interval '15 minutes' or p_mfa_at > now()+interval '30 seconds'
    or v_grant.mfa_authenticated_at is distinct from p_mfa_at then raise exception 'Fresh AAL2 MFA is required.'; end if;
  if v_request.requester_principal_id=p_principal_id or v_request.requester_auth_user_id=p_auth_user_id then raise exception 'The preparer cannot approve their own request.'; end if;
  if exists(select 1 from public.money_desk_decisions where request_id=p_request_id and (approver_principal_id=p_principal_id or approver_auth_user_id=p_auth_user_id)) then raise exception 'This principal already decided this request.'; end if;
  if p_decision not in ('APPROVE','REJECT') or char_length(trim(coalesce(p_reason,''))) not between 12 and 1000 then raise exception 'Valid decision and reason are required.'; end if;
  insert into public.money_desk_decisions(request_id,decision,approver_email,approver_subject,approver_role,approver_jit_grant_id,reason,correlation_id,approver_principal_id,approver_auth_user_id,approver_aal,approver_mfa_at,approver_assurance_source)
  values(p_request_id,p_decision,v_principal.email,'supabase:'||p_auth_user_id,case when 'admin'=any(v_principal.roles) then 'ADMIN' else 'FINANCE' end,p_jit_grant_id,trim(p_reason),v_request.correlation_id,p_principal_id,p_auth_user_id,p_aal,p_mfa_at,'SUPABASE_MFA_LOCAL');
  if p_decision='REJECT' then update public.money_desk_requests set status='REJECTED',rejected_at=now() where id=p_request_id; return jsonb_build_object('requestId',p_request_id,'status','REJECTED'); end if;
  select count(distinct approver_principal_id) into v_count from public.money_desk_decisions where request_id=p_request_id and decision='APPROVE' and approver_principal_id is not null;
  update public.money_desk_requests set approval_count=v_count,status=case when v_count>=required_approval_count then 'APPROVED' else status end,approved_at=case when v_count>=required_approval_count then now() else approved_at end where id=p_request_id returning * into v_request;
  insert into public.money_desk_events(request_id,event_type,actor_email,actor_role,payload,correlation_id) values(p_request_id,'APPROVAL_RECORDED',v_principal.email,case when 'admin'=any(v_principal.roles) then 'ADMIN' else 'FINANCE' end,jsonb_build_object('approvalCount',v_count,'requiredApprovalCount',v_request.required_approval_count,'assuranceSource','SUPABASE_MFA_LOCAL'),v_request.correlation_id);
  if v_request.status='APPROVED' then insert into public.money_desk_events(request_id,event_type,actor_email,actor_role,payload,correlation_id) values(p_request_id,'REQUEST_APPROVED',v_principal.email,case when 'admin'=any(v_principal.roles) then 'ADMIN' else 'FINANCE' end,jsonb_build_object('approvalPolicy',v_request.policy_version),v_request.correlation_id); end if;
  return jsonb_build_object('requestId',p_request_id,'status',v_request.status,'approvalCount',v_count,'requiredApprovalCount',v_request.required_approval_count);
end $$;

revoke all on function public.issue_local_supabase_mfa_money_desk_grant(uuid,uuid,text,timestamptz,text[],text,uuid) from public,anon,authenticated;
revoke all on function public.decide_local_supabase_mfa_money_desk_request(uuid,uuid,uuid,uuid,text,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.issue_local_supabase_mfa_money_desk_grant(uuid,uuid,text,timestamptz,text[],text,uuid) to service_role;
grant execute on function public.decide_local_supabase_mfa_money_desk_request(uuid,uuid,uuid,uuid,text,timestamptz,text,text) to service_role;

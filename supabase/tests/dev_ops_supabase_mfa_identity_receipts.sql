begin;

do $test$
declare v_decide text; v_trigger text;
begin
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='ops_workforce_principals' and column_name='auth_user_id') then raise exception 'Auth user binding is missing'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='money_desk_decisions' and column_name='approver_principal_id') then raise exception 'Approval principal receipt is missing'; end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='money_desk_decisions_request_principal_unique') then raise exception 'Distinct-principal index is missing'; end if;
  if has_function_privilege('authenticated','public.decide_local_supabase_mfa_money_desk_request(uuid,uuid,uuid,uuid,text,timestamptz,text,text)','EXECUTE')
    or not has_function_privilege('service_role','public.decide_local_supabase_mfa_money_desk_request(uuid,uuid,uuid,uuid,text,timestamptz,text,text)','EXECUTE') then raise exception 'Local MFA decision RPC grants are unsafe'; end if;
  select pg_get_functiondef('public.decide_local_supabase_mfa_money_desk_request(uuid,uuid,uuid,uuid,text,timestamptz,text,text)'::regprocedure) into v_decide;
  if position('requester_principal_id=p_principal_id' in v_decide)=0 or position('approver_principal_id=p_principal_id' in v_decide)=0
    or position('v_grant.mfa_authenticated_at is distinct from p_mfa_at' in v_decide)=0 then raise exception 'DB RPC does not enforce maker-checker, distinct approver, and MFA binding'; end if;
  select pg_get_functiondef('public.apply_local_supabase_mfa_money_desk_policy()'::regprocedure) into v_trigger;
  if position('new.required_approval_count:=2' in v_trigger)=0 or position('DEV_SUPABASE_MFA_TWO_PERSON' in v_trigger)=0 then raise exception 'Local MFA requests are not forced to two-person policy'; end if;
  raise notice 'PASS: Dev Supabase MFA receipts are DB-bound and distinct-principal enforced';
end $test$;

rollback;

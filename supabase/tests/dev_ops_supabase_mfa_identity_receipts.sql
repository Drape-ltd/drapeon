-- Rollback-only behavioral proof for Dev Supabase MFA Money Desk receipts.
begin;
update public.ops_runtime_configuration set environment='DEVELOPMENT',project_ref='pqptfuqogvrajozfsqzi',configured_by='rollback-test',configured_at=coalesce(configured_at,now());
delete from public.dev_ops_mfa_enablement;

do $$ begin
  if public.is_dev_ops_mfa_environment() then
    raise exception 'Runtime config alone enabled local MFA without the owner switch';
  end if;
end $$;

insert into public.dev_ops_mfa_enablement(singleton,project_ref)
values(true,'pqptfuqogvrajozfsqzi');

do $$ begin
  if not public.is_dev_ops_mfa_environment() then
    raise exception 'Owner switch plus Dev runtime config did not enable local MFA';
  end if;
end $$;

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('87000000-0000-4000-8000-000000000001','authenticated','authenticated','founders@drapeon.co','',null,'{}','{}',now(),now()),
 ('87000000-0000-4000-8000-000000000002','authenticated','authenticated','founders+ops-qa@drapeon.co','',now(),'{}','{}',now(),now()),
 ('87000000-0000-4000-8000-000000000003','authenticated','authenticated','mfa-third@example.invalid','',now(),'{}','{}',now(),now());
update public.ops_workforce_principals set auth_user_id=null,roles=array['admin'],permitted_environments=array['development'],access_review_due_at=now()+interval '1 day' where email='founders@drapeon.co';
insert into public.ops_workforce_principals(id,email,auth_user_id,status,roles,permitted_environments,access_review_due_at,created_by) values
 ('87000000-0000-4000-8000-000000000012','founders+ops-qa@drapeon.co',null,'ACTIVE',array['admin'],array['development'],now()+interval '1 day','rollback-test'),
 ('87000000-0000-4000-8000-000000000013','mfa-third@example.invalid','87000000-0000-4000-8000-000000000003','ACTIVE',array['admin'],array['development'],now()+interval '1 day','rollback-test');
do $$ begin
  begin perform public.bind_dev_ops_mfa_principal('87000000-0000-4000-8000-000000000001'); raise exception 'Unconfirmed Auth user was bound';
  exception when others then if sqlerrm='Unconfirmed Auth user was bound' then raise; end if; end;
  update auth.users set email_confirmed_at=now() where id='87000000-0000-4000-8000-000000000001';
  perform public.bind_dev_ops_mfa_principal('87000000-0000-4000-8000-000000000001');
  perform public.bind_dev_ops_mfa_principal('87000000-0000-4000-8000-000000000002');
end $$;
set local role service_role;

do $test$
declare v_preparer uuid; v_first uuid:='87000000-0000-4000-8000-000000000012'; v_second uuid:='87000000-0000-4000-8000-000000000013'; v_request uuid; v_access_grant uuid; v_access_request uuid; v_result jsonb; v_count integer;
begin
  select id into v_preparer from public.ops_workforce_principals where email='founders@drapeon.co';
  v_result:=public.issue_local_supabase_mfa_money_desk_grant(v_preparer,'87000000-0000-4000-8000-000000000001','aal2',now(),array['PAYOUT_DESTINATION_CHANGE'],'Rollback preparer elevation'); perform set_config('test.preparer_grant',v_result->>'grantId',true);
  v_result:=public.issue_local_supabase_mfa_money_desk_grant(v_first,'87000000-0000-4000-8000-000000000002','aal2',now(),array['PAYOUT_DESTINATION_CHANGE'],'Rollback first approver elevation'); perform set_config('test.first_grant',v_result->>'grantId',true);
  v_result:=public.issue_local_supabase_mfa_money_desk_grant(v_second,'87000000-0000-4000-8000-000000000003','aal2',now(),array['PAYOUT_DESTINATION_CHANGE'],'Rollback second approver elevation'); perform set_config('test.second_grant',v_result->>'grantId',true);
  v_result:=public.submit_money_desk_request('mfa-behavior-request',current_setting('test.preparer_grant')::uuid,'founders@drapeon.co','supabase:87000000-0000-4000-8000-000000000001','ADMIN','PAYOUT_DESTINATION_CHANGE','QA','fixture',null,null,null,null,null,null,'Rollback local MFA request','{}',gen_random_uuid()); v_request:=(v_result->>'requestId')::uuid;
  insert into public.money_desk_jit_grants(actor_email,actor_subject,actor_role,assurance_source,authentication_methods,action_scopes,reason,expires_at) values('founders@drapeon.co','access-founder','ADMIN','CLOUDFLARE_ACCESS',array['mfa'],array['PAYOUT_DESTINATION_CHANGE'],'Rollback Access grant',now()+interval '10 minutes') returning id into v_access_grant;
  if (v_result->>'requiredApprovalCount')::integer<>2 then raise exception 'Local request was not forced to two approvals'; end if;
  update public.money_desk_jit_grants set reason=reason||' normal update' where id=current_setting('test.first_grant')::uuid;
  begin
    update public.money_desk_jit_grants set aal='aal1' where id=current_setting('test.first_grant')::uuid;
    raise exception 'Grant receipt mutation was accepted';
  exception when others then if sqlerrm='Grant receipt mutation was accepted' then raise; end if; end;
  update public.money_desk_requests set approval_count=approval_count where id=v_request;
  begin
    update public.money_desk_requests set requester_aal='aal1' where id=v_request;
    raise exception 'Request receipt mutation was accepted';
  exception when others then if sqlerrm='Request receipt mutation was accepted' then raise; end if; end;
  begin perform public.decide_local_supabase_mfa_money_desk_request(v_request,current_setting('test.preparer_grant')::uuid,v_preparer,'87000000-0000-4000-8000-000000000001','aal2',(select mfa_authenticated_at from public.money_desk_jit_grants where id=current_setting('test.preparer_grant')::uuid),'APPROVE','Self approval must fail'); raise exception 'Preparer approved own request'; exception when others then if sqlerrm='Preparer approved own request' then raise; end if; end;
  begin perform public.decide_local_supabase_mfa_money_desk_request(v_request,current_setting('test.first_grant')::uuid,v_first,'87000000-0000-4000-8000-000000000002','aal2',now()-interval '16 minutes','APPROVE','Stale MFA must fail cleanly'); raise exception 'Stale MFA was accepted'; exception when others then if sqlerrm='Stale MFA was accepted' then raise; end if; end;
  begin perform public.decide_local_supabase_mfa_money_desk_request(v_request,current_setting('test.first_grant')::uuid,v_second,'87000000-0000-4000-8000-000000000003','aal2',(select mfa_authenticated_at from public.money_desk_jit_grants where id=current_setting('test.first_grant')::uuid),'APPROVE','Borrowed grant must fail'); raise exception 'Another principal grant was accepted'; exception when others then if sqlerrm='Another principal grant was accepted' then raise; end if; end;
  perform public.decide_local_supabase_mfa_money_desk_request(v_request,current_setting('test.first_grant')::uuid,v_first,'87000000-0000-4000-8000-000000000002','aal2',(select mfa_authenticated_at from public.money_desk_jit_grants where id=current_setting('test.first_grant')::uuid),'APPROVE','First independent approval');
  if (select status from public.money_desk_requests where id=v_request)<>'PENDING_APPROVAL' then raise exception 'One approval made request approved'; end if;
  begin perform public.decide_money_desk_request(v_request,v_access_grant,'founders@drapeon.co','access-founder','ADMIN','APPROVE','Access must not approve a locally prepared request'); raise exception 'Local request used Access decision path'; exception when others then if sqlerrm='Local request used Access decision path' then raise; end if; end;
  begin perform public.decide_local_supabase_mfa_money_desk_request(v_request,current_setting('test.first_grant')::uuid,v_first,'87000000-0000-4000-8000-000000000002','aal2',(select mfa_authenticated_at from public.money_desk_jit_grants where id=current_setting('test.first_grant')::uuid),'APPROVE','Duplicate approval must fail'); raise exception 'Same principal approved twice'; exception when others then if sqlerrm='Same principal approved twice' then raise; end if; end;
  perform public.decide_local_supabase_mfa_money_desk_request(v_request,current_setting('test.second_grant')::uuid,v_second,'87000000-0000-4000-8000-000000000003','aal2',(select mfa_authenticated_at from public.money_desk_jit_grants where id=current_setting('test.second_grant')::uuid),'APPROVE','Second independent approval');
  if (select status from public.money_desk_requests where id=v_request)<>'APPROVED' then raise exception 'Second approval did not approve request'; end if;
  v_result:=public.submit_money_desk_request('mfa-access-request',v_access_grant,'founders@drapeon.co','access-founder','ADMIN','PAYOUT_DESTINATION_CHANGE','QA','access-fixture',null,null,null,null,null,null,'Rollback Access request','{}',gen_random_uuid()); v_access_request:=(v_result->>'requestId')::uuid;
  begin perform public.decide_local_supabase_mfa_money_desk_request(v_access_request,current_setting('test.first_grant')::uuid,v_first,'87000000-0000-4000-8000-000000000002','aal2',(select mfa_authenticated_at from public.money_desk_jit_grants where id=current_setting('test.first_grant')::uuid),'APPROVE','Access crossover must fail'); raise exception 'Access-prepared request used local decision path'; exception when others then if sqlerrm='Access-prepared request used local decision path' then raise; end if; end;
  update public.ops_runtime_configuration set environment='PRODUCTION',project_ref='wkfsrunetmgjdtcurmoj';
  begin perform public.issue_local_supabase_mfa_money_desk_grant(v_first,'87000000-0000-4000-8000-000000000002','aal2',now(),array['PAYOUT_DESTINATION_CHANGE'],'Production gate must reject'); raise exception 'Production gate accepted local assurance'; exception when others then if sqlerrm='Production gate accepted local assurance' then raise; end if; end;
  update public.ops_runtime_configuration set environment='DEVELOPMENT',project_ref='pqptfuqogvrajozfsqzi';
  select count(*) into v_count from public.money_desk_decisions where request_id=v_request and decision='APPROVE'; if v_count<>2 then raise exception 'Expected exactly two approval receipts'; end if;
end $test$;

reset role;
create temporary table local_mfa_no_grant_probe (like public.money_desk_requests including defaults) on commit drop;
alter table local_mfa_no_grant_probe alter column requester_jit_grant_id drop not null;
create trigger zz_apply_local_supabase_mfa_money_desk_policy before insert on local_mfa_no_grant_probe for each row execute function public.apply_local_supabase_mfa_money_desk_policy();
insert into local_mfa_no_grant_probe(idempotency_key,request_hash,action_type,target_type,target_id,reason,action_payload,requester_email,requester_subject,requester_role,requester_jit_grant_id,risk_level,required_approval_count) values('no-grant-probe','hash','PAYOUT_DESTINATION_CHANGE','QA','no-grant','No grant trigger probe','{}','qa@example.invalid','qa','ADMIN',null,'HIGH',2);
do $$ begin if not exists(select 1 from local_mfa_no_grant_probe) then raise exception 'No-grant trigger path rejected normal insert'; end if; end $$;
rollback;

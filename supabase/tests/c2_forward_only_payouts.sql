begin;

create temporary table c2_payout_probe (
  like public.payouts including defaults including constraints
) on commit drop;
create trigger c2_payout_probe_guard
before update on c2_payout_probe
for each row execute function public.guard_payout_forward_status();

do $test$
declare
  v_id text;
  v_response jsonb;
begin
  insert into c2_payout_probe (
    tailor_profile_id, amount, currency, provider, status,
    provider_payout_id, provider_destination_id, provider_response
  ) values (
    'c2-tailor', 1000, 'USD', 'STRIPE', 'PENDING',
    'tr_c2', 'acct_c2', '{"reservation":true}'::jsonb
  ) returning id into v_id;

  update c2_payout_probe set status='PROCESSING',
    provider_response='{"transfer_created":true}'::jsonb where id=v_id;
  select provider_response into v_response from c2_payout_probe where id=v_id;
  if not (v_response ? 'reservation' and v_response ? 'transfer_created') then
    raise exception 'payout provider evidence was replaced: %', v_response;
  end if;

  update c2_payout_probe set status='PAID',completed_at=now() where id=v_id;
  begin
    update c2_payout_probe set status='PROCESSING',completed_at=null where id=v_id;
    raise exception 'PAID payout moved backward';
  exception when others then
    if sqlerrm <> 'PAID_PAYOUT_COMPLETION_IMMUTABLE' then raise; end if;
  end;
  begin
    update c2_payout_probe set provider_destination_id=null where id=v_id;
    raise exception 'pinned destination was cleared';
  exception when others then
    if sqlerrm <> 'PAYOUT_DESTINATION_IMMUTABLE' then raise; end if;
  end;
  begin
    update c2_payout_probe set amount=900 where id=v_id;
    raise exception 'payout amount changed';
  exception when others then
    if sqlerrm <> 'PAYOUT_MONEY_IDENTITY_IMMUTABLE' then raise; end if;
  end;

  perform set_config('drape.payout_transfer_reversal','evidenced',true);
  update c2_payout_probe set status='REVERSED' where id=v_id;
  perform set_config('drape.payout_transfer_reversal','',true);
  if (select status::text from c2_payout_probe where id=v_id) <> 'REVERSED' then
    raise exception 'evidenced payout reversal did not apply';
  end if;
  raise notice 'PASS: C2 payout status and identity are forward-only';
end;
$test$;

do $test$
declare
  v_guard text;
  v_correction text;
begin
  select pg_get_functiondef('public.guard_payout_forward_status()'::regprocedure) into v_guard;
  select pg_get_functiondef(
    'public.apply_reviewed_snapshot_payout_destination_correction(uuid,text,text)'::regprocedure
  ) into v_correction;
  if position('operation.operation_number > 1' in v_guard)=0
     or position('operation.reviewed_correction_id = correction.id' in v_guard)=0
     or position('operation.status = ''RESERVED''' in v_guard)=0 then
    raise exception 'C2 guard does not require the reviewed replacement operation';
  end if;
  if position('insert into public.payout_destination_corrections' in lower(v_correction))=0
     or position('insert into public.payout_provider_operations' in lower(v_correction))=0
     or position('update public.payouts set status=''processing''' in lower(v_correction))=0 then
    raise exception 'Two-person destination correction no longer creates the evidence required by C2';
  end if;
  if position('insert into public.payout_destination_corrections' in lower(v_correction))
     > position('update public.payouts set status=''processing''' in lower(v_correction))
     or position('insert into public.payout_provider_operations' in lower(v_correction))
     > position('update public.payouts set status=''processing''' in lower(v_correction)) then
    raise exception 'Two-person correction evidence is not durable before the guarded retry';
  end if;
  raise notice 'PASS: reviewed destination correction remains the only FAILED/BLOCKED retry path';
end;
$test$;

rollback;


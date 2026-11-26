-- A single, service-only exception for an exact Bachs NGN proof. The public
-- resolver and the configured route remain DISABLED. No provider call occurs
-- in this migration.
set local lock_timeout = '5s';

create table public.phase4_payment_proofs (
  id uuid primary key default gen_random_uuid(),
  customer_id text not null,
  tailor_profile_id text not null,
  order_id text not null unique,
  amount_minor integer not null check (amount_minor > 0),
  currency text not null default 'NGN' check (currency = 'NGN'),
  country_code text not null default 'NG' check (country_code = 'NG'),
  route_id uuid not null references public.payment_routes(id) on delete restrict,
  route_version integer not null check (route_version > 0),
  expires_at timestamptz not null,
  state text not null default 'ARMED'
    check (state in ('ARMED','SNAPSHOTTED','CHECKOUT_RESERVED','EXPIRED','KILLED')),
  payment_attempt_id uuid unique,
  created_by text not null,
  created_at timestamptz not null default now(),
  snapshotted_at timestamptz,
  checkout_reserved_at timestamptz,
  closed_at timestamptz,
  closed_by text,
  close_reason text,
  constraint phase4_proof_expiry_window check
    (expires_at > created_at and expires_at <= created_at + interval '1 hour')
);
create unique index phase4_one_open_proof
  on public.phase4_payment_proofs ((true))
  where state in ('ARMED','SNAPSHOTTED','CHECKOUT_RESERVED');
create index phase4_proof_expiry_idx on public.phase4_payment_proofs(expires_at)
  where state in ('ARMED','SNAPSHOTTED','CHECKOUT_RESERVED');

create table public.phase4_payment_proof_events (
  id uuid primary key default gen_random_uuid(),
  proof_id uuid not null references public.phase4_payment_proofs(id) on delete restrict,
  event_type text not null check
    (event_type in ('ARMED','SNAPSHOTTED','CHECKOUT_RESERVED','ATTEMPT_BOUND','EXPIRED','KILLED')),
  actor text not null,
  reason text,
  payment_attempt_id uuid,
  occurred_at timestamptz not null default now()
);
create index phase4_payment_proof_events_proof_idx
  on public.phase4_payment_proof_events(proof_id,occurred_at);
alter table public.phase4_payment_proofs enable row level security;
alter table public.phase4_payment_proof_events enable row level security;
revoke all on public.phase4_payment_proofs,public.phase4_payment_proof_events
  from public,anon,authenticated,service_role;
grant select on public.phase4_payment_proofs,public.phase4_payment_proof_events
  to service_role;

create function public.guard_phase4_payment_proof()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if tg_op <> 'UPDATE' then raise exception 'PHASE4_PROOF_APPEND_ONLY'; end if;
  if current_setting('app.phase4_proof_write',true) is distinct from 'on' then
    raise exception 'PHASE4_PROOF_RPC_REQUIRED';
  end if;
  if (old.id,old.customer_id,old.tailor_profile_id,old.order_id,
      old.amount_minor,old.currency,old.country_code,old.route_id,
      old.route_version,old.expires_at,old.created_by,old.created_at)
     is distinct from
     (new.id,new.customer_id,new.tailor_profile_id,new.order_id,
      new.amount_minor,new.currency,new.country_code,new.route_id,
      new.route_version,new.expires_at,new.created_by,new.created_at) then
    raise exception 'PHASE4_PROOF_TUPLE_IMMUTABLE';
  end if;
  if old.state in ('EXPIRED','KILLED') or
    (old.state='ARMED' and new.state not in ('SNAPSHOTTED','EXPIRED','KILLED')) or
    (old.state='SNAPSHOTTED' and new.state not in ('CHECKOUT_RESERVED','EXPIRED','KILLED')) or
    (old.state='CHECKOUT_RESERVED' and new.state not in ('CHECKOUT_RESERVED','EXPIRED','KILLED')) then
    raise exception 'PHASE4_PROOF_STATUS_NOT_FORWARD';
  end if;
  if old.payment_attempt_id is not null and
     old.payment_attempt_id is distinct from new.payment_attempt_id then
    raise exception 'PHASE4_PROOF_ATTEMPT_IMMUTABLE';
  end if;
  return new;
end $$;
create trigger guard_phase4_payment_proof_before_update
  before update on public.phase4_payment_proofs for each row
  execute function public.guard_phase4_payment_proof();
revoke execute on function public.guard_phase4_payment_proof()
  from public,anon,authenticated,service_role;

create function public.open_phase4_payment_proof(
  p_customer_id text,p_tailor_profile_id text,p_order_id text,
  p_amount_minor integer,p_route_id uuid,p_route_version integer,
  p_expires_at timestamptz,p_actor text
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_route public.payment_routes%rowtype;
  v_order public.orders%rowtype;
  v_quote public.order_quotes%rowtype;
  v_id uuid;
begin
  if p_actor is null or length(trim(p_actor)) < 3
    or p_amount_minor is null or p_amount_minor <= 0
    or p_expires_at <= now() or p_expires_at > now() + interval '1 hour'
    or p_customer_id is null or p_tailor_profile_id is null or p_order_id is null then
    raise exception 'PHASE4_PROOF_TUPLE_INVALID';
  end if;
  if (select count(*) from public.payment_routes where status='ENABLED') <> 0 then
    raise exception 'PHASE4_PROOF_PUBLIC_ROUTE_AVAILABLE';
  end if;
  select * into v_route from public.payment_routes
    where id=p_route_id and version=p_route_version for share;
  if v_route.id is null or v_route.status <> 'DISABLED'
    or v_route.provider <> 'BACHS' or v_route.tailor_country_code <> 'NG'
    or v_route.charge_currency <> 'NGN' or v_route.payout_currency <> 'NGN'
    or v_route.payment_method_types <> array['NGN_CARD']::text[] then
    raise exception 'PHASE4_PROOF_ROUTE_INVALID';
  end if;
  select * into v_order from public.orders where id::text=p_order_id for share;
  if v_order.id is null or v_order.customer_id::text <> p_customer_id
    or v_order.tailor_profile_id::text <> p_tailor_profile_id
    or v_order.stage <> 'QUOTE_SENT' or v_order.order_kind <> 'CUSTOM'
    or v_order.active_quote_id is null or v_order.accepted_route_snapshot_at is not null then
    raise exception 'PHASE4_PROOF_ORDER_INVALID';
  end if;
  select * into v_quote from public.order_quotes
    where id=v_order.active_quote_id and order_id::text=p_order_id
      and version=v_order.active_quote_version and status='ACTIVE' for share;
  if v_quote.id is null or v_quote.currency <> 'NGN'
    or v_quote.platform_fee_amount <> 0
    or v_quote.total_amount + floor(((v_quote.total_amount::numeric * 200)+5000)/10000)::integer
       <> p_amount_minor then
    raise exception 'PHASE4_PROOF_AMOUNT_INVALID';
  end if;
  insert into public.phase4_payment_proofs
    (customer_id,tailor_profile_id,order_id,amount_minor,route_id,
     route_version,expires_at,created_by)
  values (p_customer_id,p_tailor_profile_id,p_order_id,p_amount_minor,
          p_route_id,p_route_version,p_expires_at,trim(p_actor))
  returning id into v_id;
  insert into public.phase4_payment_proof_events(proof_id,event_type,actor)
    values (v_id,'ARMED',trim(p_actor));
  return v_id;
end $$;
revoke execute on function public.open_phase4_payment_proof(text,text,text,integer,uuid,integer,timestamptz,text)
  from public,anon,authenticated;
grant execute on function public.open_phase4_payment_proof(text,text,text,integer,uuid,integer,timestamptz,text)
  to service_role;

create function public.phase4_proof_context_valid(
  p_order_id text,p_customer_id uuid,p_quote_id uuid,
  p_route_id uuid,p_route_version integer
) returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.phase4_payment_proofs p
    join public.payment_routes r on r.id=p.route_id and r.version=p.route_version
    join public.order_quotes q on q.id=p_quote_id and q.order_id::text=p.order_id
    where p.id::text=current_setting('app.phase4_proof_id',true)
      and p.state='ARMED' and p.expires_at>now()
      and p.order_id=p_order_id and p.customer_id=p_customer_id::text
      and p.route_id=p_route_id and p.route_version=p_route_version
      and q.id=p_quote_id and q.status='ACTIVE'
      and q.platform_fee_amount=0 and q.currency='NGN'
      and q.total_amount + floor(((q.total_amount::numeric * 200)+5000)/10000)::integer
          =p.amount_minor
      and r.status='DISABLED' and r.provider='BACHS'
      and r.tailor_country_code='NG' and r.charge_currency='NGN'
      and r.payout_currency='NGN'
      and not exists(select 1 from public.payment_routes where status='ENABLED')
  )
$$;
revoke execute on function public.phase4_proof_context_valid(text,uuid,uuid,uuid,integer)
  from public,anon,authenticated;
grant execute on function public.phase4_proof_context_valid(text,uuid,uuid,uuid,integer)
  to service_role;

-- Clone the exact existing acceptance implementations, preserving every
-- quote, route-version, delivery, tax and destination check. Only the cloned
-- service-only entrypoints gain the exact disabled-route proof exception.
do $$
declare v_base text; v_v2 text;
begin
  select pg_get_functiondef(
    'public.accept_active_order_quote_with_route_snapshot(text,uuid,uuid,integer,uuid,integer,uuid,integer,uuid,text,text)'::regprocedure
  ) into v_base;
  select pg_get_functiondef(
    'public.accept_active_order_quote_with_route_snapshot_v2(text,uuid,uuid,integer,uuid,integer,uuid,integer,uuid,text,text)'::regprocedure
  ) into v_v2;
  if md5(v_base)<>'5df85ea3c88b663b0d7fcd2626f86bd5'
    or md5(v_v2)<>'d3beda2da3da4bb51a38bb72f4eb52db'
    or position('or v_route.status = ''DISABLED''' in v_base)=0
    or position('if v_environment <> ''SANDBOX'' or v_route.status <> ''SANDBOX_ONLY'' then' in v_base)=0 then
    raise exception 'PHASE4_PROOF_ACCEPTANCE_BASELINE_CHANGED';
  end if;
  v_base:=replace(v_base,
    'public.accept_active_order_quote_with_route_snapshot(',
    'public.accept_phase4_order_quote_with_route_snapshot(');
  v_base:=replace(v_base,
    'or v_route.status = ''DISABLED''',
    'or (v_route.status = ''DISABLED'' and not public.phase4_proof_context_valid(p_order_id,p_customer_id,p_quote_id,p_payment_route_id,p_payment_route_version))');
  v_base:=replace(v_base,
    'if v_environment <> ''SANDBOX'' or v_route.status <> ''SANDBOX_ONLY'' then',
    'if not public.phase4_proof_context_valid(p_order_id,p_customer_id,p_quote_id,p_payment_route_id,p_payment_route_version) then');
  execute v_base;

  v_v2:=replace(v_v2,
    'public.accept_active_order_quote_with_route_snapshot_v2(',
    'public.accept_phase4_order_quote_with_route_snapshot_v2(');
  v_v2:=replace(v_v2,
    'public.accept_active_order_quote_with_route_snapshot(',
    'public.accept_phase4_order_quote_with_route_snapshot(');
  execute v_v2;
end $$;
revoke execute on function public.accept_phase4_order_quote_with_route_snapshot(
  text,uuid,uuid,integer,uuid,integer,uuid,integer,uuid,text,text
) from public,anon,authenticated;
grant execute on function public.accept_phase4_order_quote_with_route_snapshot(
  text,uuid,uuid,integer,uuid,integer,uuid,integer,uuid,text,text
) to service_role;
revoke execute on function public.accept_phase4_order_quote_with_route_snapshot_v2(
  text,uuid,uuid,integer,uuid,integer,uuid,integer,uuid,text,text
) from public,anon,authenticated;
grant execute on function public.accept_phase4_order_quote_with_route_snapshot_v2(
  text,uuid,uuid,integer,uuid,integer,uuid,integer,uuid,text,text
) to service_role;

create function public.accept_phase4_payment_proof(
  p_proof_id uuid,p_delivery_rule_id uuid,p_delivery_rule_version integer,
  p_destination_id uuid,p_delivery_country_code text,p_terms_version text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_proof public.phase4_payment_proofs%rowtype;
  v_order public.orders%rowtype; v_result jsonb;
begin
  select * into v_proof from public.phase4_payment_proofs
    where id=p_proof_id for update;
  if v_proof.id is null or v_proof.state<>'ARMED'
    or v_proof.expires_at<=now() then raise exception 'PHASE4_PROOF_NOT_ARMED'; end if;
  select * into v_order from public.orders where id::text=v_proof.order_id for update;
  if v_order.id is null or v_order.customer_id::text<>v_proof.customer_id
    or v_order.tailor_profile_id::text<>v_proof.tailor_profile_id
    or v_order.stage<>'QUOTE_SENT' or v_order.active_quote_id is null then
    raise exception 'PHASE4_PROOF_ORDER_CHANGED';
  end if;
  perform set_config('app.phase4_proof_id',v_proof.id::text,true);
  v_result:=public.accept_phase4_order_quote_with_route_snapshot_v2(
    v_proof.order_id,v_proof.customer_id::uuid,v_order.active_quote_id,
    v_order.active_quote_version,v_proof.route_id,v_proof.route_version,
    p_delivery_rule_id,p_delivery_rule_version,p_destination_id,
    p_delivery_country_code,p_terms_version);
  if (v_result->>'totalAmount')::integer is distinct from v_proof.amount_minor
    or v_result->>'chargeProvider'<>'BACHS' then
    raise exception 'PHASE4_PROOF_ACCEPTED_TOTAL_MISMATCH';
  end if;
  perform set_config('app.phase4_proof_write','on',true);
  update public.phase4_payment_proofs
  set state='SNAPSHOTTED',snapshotted_at=now()
  where id=v_proof.id;
  insert into public.phase4_payment_proof_events(proof_id,event_type,actor)
    values(v_proof.id,'SNAPSHOTTED','PHASE4_PROOF_ACTION');
  return v_result;
end $$;
revoke execute on function public.accept_phase4_payment_proof(uuid,uuid,integer,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.accept_phase4_payment_proof(uuid,uuid,integer,uuid,text,text)
  to service_role;

create function public.authorize_phase4_proof_checkout(
  p_proof_id uuid,p_order_id text,p_amount_minor integer,
  p_currency text,p_phase text,p_method text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_proof public.phase4_payment_proofs%rowtype;
  v_order public.orders%rowtype; v_route public.payment_routes%rowtype;
begin
  select * into v_proof from public.phase4_payment_proofs where id=p_proof_id for update;
  if v_proof.id is null or v_proof.state not in ('SNAPSHOTTED','CHECKOUT_RESERVED')
    or v_proof.expires_at<=now() or v_proof.order_id<>p_order_id
    or v_proof.amount_minor<>p_amount_minor or p_currency<>'NGN'
    or p_phase<>'INITIAL_ORDER' or p_method<>'NGN_CARD' then
    raise exception 'PHASE4_PROOF_CHECKOUT_REFUSED';
  end if;
  select * into v_route from public.payment_routes
    where id=v_proof.route_id and version=v_proof.route_version for share;
  select * into v_order from public.orders where id::text=p_order_id for share;
  if v_route.id is null or v_route.status<>'DISABLED' or v_route.provider<>'BACHS'
    or v_order.id is null or v_order.customer_id::text<>v_proof.customer_id
    or v_order.tailor_profile_id::text<>v_proof.tailor_profile_id
    or v_order.stage not in ('PAYMENT_PENDING','PAYMENT_FAILED')
    or v_order.payment_route_id<>v_proof.route_id
    or v_order.payment_route_version<>v_proof.route_version
    or v_order.charge_provider_snapshot<>'BACHS'
    or v_order.charge_currency_snapshot<>'NGN'
    or v_order.total_amount<>v_proof.amount_minor
    or exists(select 1 from public.payment_routes where status='ENABLED') then
    raise exception 'PHASE4_PROOF_CHECKOUT_REFUSED';
  end if;
  if v_proof.state='SNAPSHOTTED' then
    perform set_config('app.phase4_proof_write','on',true);
    update public.phase4_payment_proofs
      set state='CHECKOUT_RESERVED',checkout_reserved_at=now()
      where id=v_proof.id;
    insert into public.phase4_payment_proof_events(proof_id,event_type,actor)
      values(v_proof.id,'CHECKOUT_RESERVED','PHASE4_PROOF_ACTION');
  end if;
  return jsonb_build_object('proofId',v_proof.id,'orderId',v_proof.order_id,
    'amount',v_proof.amount_minor,'routeId',v_proof.route_id,
    'routeVersion',v_proof.route_version,'customerId',v_proof.customer_id);
end $$;
revoke execute on function public.authorize_phase4_proof_checkout(uuid,text,integer,text,text,text)
  from public,anon,authenticated;
grant execute on function public.authorize_phase4_proof_checkout(uuid,text,integer,text,text,text)
  to service_role;

create function public.bind_phase4_proof_attempt(p_proof_id uuid,p_attempt_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_proof public.phase4_payment_proofs%rowtype;
  v_attempt public.order_payments%rowtype;
begin
  select * into v_proof from public.phase4_payment_proofs where id=p_proof_id for update;
  select * into v_attempt from public.order_payments where id=p_attempt_id;
  if v_proof.id is null or v_proof.state<>'CHECKOUT_RESERVED'
    or v_proof.expires_at<=now() or v_attempt.id is null
    or v_attempt.order_id::text<>v_proof.order_id
    or v_attempt.phase<>'INITIAL_ORDER' or v_attempt.provider<>'BACHS'
    or v_attempt.currency<>'NGN' or v_attempt.amount<>v_proof.amount_minor
    or v_attempt.idempotency_key<>('DRAPE-PAY-'||v_proof.order_id||'-Q'||
      (select active_quote_version::text from public.orders where id::text=v_proof.order_id))
    or (v_proof.payment_attempt_id is not null and
        v_proof.payment_attempt_id<>p_attempt_id) then
    raise exception 'PHASE4_PROOF_ATTEMPT_REFUSED';
  end if;
  if v_proof.payment_attempt_id is null then
    perform set_config('app.phase4_proof_write','on',true);
    update public.phase4_payment_proofs set payment_attempt_id=p_attempt_id
      where id=v_proof.id;
    insert into public.phase4_payment_proof_events
      (proof_id,event_type,actor,payment_attempt_id)
      values(v_proof.id,'ATTEMPT_BOUND','PHASE4_PROOF_ACTION',p_attempt_id);
  end if;
  return true;
end $$;
revoke execute on function public.bind_phase4_proof_attempt(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.bind_phase4_proof_attempt(uuid,uuid)
  to service_role;

create function public.kill_phase4_payment_proof(
  p_proof_id uuid,p_actor text,p_reason text
) returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_proof public.phase4_payment_proofs%rowtype;
begin
  if length(trim(coalesce(p_actor,'')))<3 or length(trim(coalesce(p_reason,'')))<8 then
    raise exception 'PHASE4_PROOF_KILL_REASON_REQUIRED';
  end if;
  select * into v_proof from public.phase4_payment_proofs where id=p_proof_id for update;
  if v_proof.id is null then raise exception 'PHASE4_PROOF_NOT_FOUND'; end if;
  if v_proof.state='KILLED' then return false; end if;
  if v_proof.state='EXPIRED' then raise exception 'PHASE4_PROOF_ALREADY_EXPIRED'; end if;
  perform set_config('app.phase4_proof_write','on',true);
  update public.phase4_payment_proofs set state='KILLED',closed_at=now(),
    closed_by=trim(p_actor),close_reason=trim(p_reason) where id=p_proof_id;
  insert into public.phase4_payment_proof_events
    (proof_id,event_type,actor,reason,payment_attempt_id)
    values(p_proof_id,'KILLED',trim(p_actor),trim(p_reason),v_proof.payment_attempt_id);
  return true;
end $$;
revoke execute on function public.kill_phase4_payment_proof(uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.kill_phase4_payment_proof(uuid,text,text)
  to service_role;

create function public.expire_phase4_payment_proofs(p_limit integer default 100)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_row public.phase4_payment_proofs%rowtype;
  v_count integer:=0;
begin
  for v_row in select * from public.phase4_payment_proofs
    where state in ('ARMED','SNAPSHOTTED','CHECKOUT_RESERVED')
      and expires_at<=now()
    order by expires_at,id for update skip locked
    limit least(greatest(coalesce(p_limit,100),1),100)
  loop
    perform set_config('app.phase4_proof_write','on',true);
    update public.phase4_payment_proofs set state='EXPIRED',
      closed_at=now(),closed_by='SYSTEM',close_reason='EXPIRY'
      where id=v_row.id;
    insert into public.phase4_payment_proof_events
      (proof_id,event_type,actor,reason,payment_attempt_id)
      values(v_row.id,'EXPIRED','SYSTEM','EXPIRY',v_row.payment_attempt_id);
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;
revoke execute on function public.expire_phase4_payment_proofs(integer)
  from public,anon,authenticated;
grant execute on function public.expire_phase4_payment_proofs(integer)
  to service_role;

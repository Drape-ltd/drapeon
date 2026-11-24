-- Dev migration history version: 20261028021731.
-- Bachs does not hold a recipient's first bank withdrawal for platform review.
-- Drapeon therefore reviews a new Bachs destination before enabling any first
-- payout release to its connected balance. This is separate from bank withdrawal.

create or replace function public.ops_review_bachs_first_payout_release(
  p_destination_id uuid,
  p_actor_id uuid,
  p_outcome text,
  p_evidence_reference text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.ops_workforce_principals%rowtype;
  v_destination public.payout_destinations%rowtype;
  v_existing public.payout_destination_review_events%rowtype;
  v_outcome text := upper(trim(coalesce(p_outcome, '')));
  v_evidence_reference text := trim(coalesce(p_evidence_reference, ''));
  v_reason text := trim(coalesce(p_reason, ''));
  v_active boolean;
begin
  if p_destination_id is null or p_actor_id is null
    or v_outcome not in ('CLEARED', 'BLOCKED')
    or length(v_evidence_reference) not between 1 and 500
    or length(v_reason) not between 12 and 1000 then
    raise exception using errcode = '22023', message = 'Destination, outcome, evidence reference and review reason are required';
  end if;

  select * into v_actor
  from public.ops_workforce_principals
  where id = p_actor_id
  for share;
  if not found or v_actor.status <> 'ACTIVE' or not ('admin' = any(v_actor.roles))
    or (v_actor.access_review_due_at is not null and v_actor.access_review_due_at <= now()) then
    raise exception using errcode = '42501', message = 'An active, reviewed Ops admin is required';
  end if;

  select * into v_destination
  from public.payout_destinations
  where id = p_destination_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Payout destination was not found';
  end if;
  if v_destination.provider <> 'BACHS' then
    raise exception using errcode = '23514', message = 'This review path is only for Bachs destinations';
  end if;

  select * into v_existing
  from public.payout_destination_review_events
  where payout_destination_id = p_destination_id;
  if found then
    if v_existing.outcome = v_outcome then
      return jsonb_build_object('destination_id', p_destination_id, 'outcome', v_outcome, 'active', v_destination.active, 'duplicate', true);
    end if;
    raise exception using errcode = '23514', message = 'A first-release review is final; use a newly verified destination to change the decision';
  end if;
  if v_destination.first_withdrawal_review_status <> 'PENDING' then
    raise exception using errcode = '23514', message = 'Destination is no longer awaiting first-release review';
  end if;
  if v_destination.capability_checked_at is null
    or v_destination.capability_checked_at < now() - interval '15 minutes' then
    raise exception using errcode = '23514', message = 'Refresh Bachs capabilities immediately before reviewing this destination';
  end if;
  if v_outcome = 'CLEARED'
    and (not v_destination.transfers_enabled or not v_destination.payouts_enabled) then
    raise exception using errcode = '23514', message = 'Bachs transfer and payout capabilities are not currently ready';
  end if;

  v_active := v_outcome = 'CLEARED'
    and v_destination.transfers_enabled
    and v_destination.payouts_enabled
    and v_destination.capability_checked_at >= now() - interval '15 minutes';

  insert into public.payout_destination_review_events (
    payout_destination_id, actor_workforce_principal_id, outcome, reason, evidence
  ) values (
    p_destination_id, p_actor_id, v_outcome, v_reason,
    jsonb_build_object(
      'provider', 'BACHS',
      'provider_account_ref', v_destination.provider_account_ref,
      'review_reference', v_evidence_reference,
      'capability_checked_at', v_destination.capability_checked_at,
      'country_code', v_destination.country_code,
      'currency', v_destination.currency,
      'review_scope', 'drapeon_first_payout_release'
    )
  );

  perform set_config('app.payout_destination_review_actor_id', p_actor_id::text, true);
  update public.payout_destinations
  set first_withdrawal_review_status = v_outcome,
      active = v_active
  where id = p_destination_id;

  insert into public.audit_logs (actor_id, actor_role, event, severity, payload)
  values (
    p_actor_id::text,
    'ADMIN',
    'ops.bachs_first_payout_release_reviewed',
    'notice',
    jsonb_build_object(
      'destination_id', p_destination_id,
      'provider', 'BACHS',
      'outcome', v_outcome,
      'active', v_active,
      'review_reference', v_evidence_reference,
      'reason', v_reason
    )
  );

  return jsonb_build_object('destination_id', p_destination_id, 'outcome', v_outcome, 'active', v_active, 'duplicate', false);
end
$function$;

revoke all on function public.ops_review_bachs_first_payout_release(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.ops_review_bachs_first_payout_release(uuid, uuid, text, text, text) to service_role;

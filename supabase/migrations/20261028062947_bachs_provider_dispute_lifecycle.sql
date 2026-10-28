-- Serialize Bachs dispute lifecycle changes by dispute ID. Provider event
-- delivery can be reordered, so only a newer signed provider timestamp may
-- replace a stored observation. Equal-time conflicts fail closed.

create or replace function public.record_bachs_provider_dispute_event(
  p_provider_dispute_id text,
  p_provider_charge_id text,
  p_provider_payment_id text,
  p_payment_id uuid,
  p_order_id text,
  p_customer_id uuid,
  p_tailor_id uuid,
  p_amount integer,
  p_currency public.currency,
  p_status text,
  p_reason text,
  p_evidence_due_at timestamptz,
  p_provider_event_id text,
  p_provider_event_type text,
  p_provider_updated_at timestamptz,
  p_raw_status text,
  p_metadata jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.provider_disputes%rowtype;
  v_inserted_id uuid;
  v_previous_at timestamptz;
  v_status text;
  v_blocked boolean;
  v_metadata jsonb;
  v_payment public.order_payments%rowtype;
  v_order public.orders%rowtype;
  v_charge_amount integer;
begin
  if p_provider_dispute_id is null or p_provider_dispute_id !~ '^dsp_[A-Za-z0-9_-]+$'
    or p_provider_charge_id is null or p_provider_charge_id !~ '^ch_[A-Za-z0-9_-]+$'
    or p_amount is null or p_amount <= 0
    or p_currency is null
    or p_status is null
    or p_status not in ('NEEDS_RESPONSE', 'UNDER_REVIEW', 'WON', 'LOST', 'UNKNOWN')
    or p_provider_event_id is null or length(btrim(p_provider_event_id)) = 0
    or p_provider_event_type is null
    or p_provider_event_type not in ('dispute.created', 'dispute.updated')
    or p_provider_updated_at is null then
    raise exception 'invalid Bachs dispute event input';
  end if;

  if p_status = 'WON' and p_payment_id is not null then
    if p_metadata is null or jsonb_typeof(p_metadata) <> 'object'
      or coalesce(p_metadata ->> 'charge_amount_minor', '') !~ '^[1-9][0-9]*$' then
      raise exception 'invalid Bachs dispute charge snapshot';
    end if;
    v_charge_amount := (p_metadata ->> 'charge_amount_minor')::integer;
    select * into v_payment
    from public.order_payments
    where id = p_payment_id;
    if not found
      or v_payment.provider <> 'BACHS'::public.payment_provider
      or v_payment.provider_charge_id is distinct from p_provider_charge_id
      or v_payment.provider_payment_id is distinct from p_provider_payment_id
      or v_payment.order_id is distinct from p_order_id
      or v_payment.currency is distinct from p_currency
      or v_payment.amount is distinct from v_charge_amount
      or p_amount > v_payment.amount
      or v_payment.status not in ('SUCCEEDED', 'PARTIAL_REFUND', 'REFUNDED') then
      raise exception 'Bachs dispute does not match the saved payment attempt';
    end if;
    select * into v_order from public.orders where id = p_order_id;
    if not found
      or v_order.charge_provider_snapshot is distinct from 'BACHS'
      or v_order.charge_currency_snapshot is distinct from p_currency::text
      or v_order.accepted_route_snapshot_at is null then
      raise exception 'Bachs dispute does not match the accepted order snapshot';
    end if;
  end if;

  -- A provider result can release settlement only when the signed webhook was
  -- associated with an exact Drapeon payment and order, and Bachs says WON.
  v_status := p_status;
  v_blocked := not (p_status = 'WON' and p_payment_id is not null and p_order_id is not null);
  v_metadata := coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
    'provider_updated_at', p_provider_updated_at,
    'provider_event_type', p_provider_event_type,
    'raw_status', p_raw_status
  );

  loop
    select * into v_existing
    from public.provider_disputes
    where provider = 'BACHS'::public.payment_provider
      and provider_dispute_id = p_provider_dispute_id
    for update;

    if found then
      v_previous_at := nullif(v_existing.metadata ->> 'provider_updated_at', '')::timestamptz;
      if v_previous_at is not null and p_provider_updated_at < v_previous_at then
        return 'STALE';
      end if;

      -- A dispute is tied to the charge that opened it. A later event cannot
      -- silently retarget it to another charge or payment.
      if v_existing.provider_charge_id is distinct from p_provider_charge_id
        or (v_existing.payment_id is not null and p_payment_id is not null
          and v_existing.payment_id is distinct from p_payment_id) then
        update public.provider_disputes
        set status = 'UNKNOWN',
            money_movement_blocked = true,
            closed_at = null,
            provider_event_id = p_provider_event_id,
            metadata = v_existing.metadata || jsonb_build_object(
              'identity_conflict', true,
              'conflicting_charge_id', p_provider_charge_id,
              'conflicting_payment_id', p_payment_id,
              'conflicting_event_id', p_provider_event_id,
              'conflicting_provider_updated_at', p_provider_updated_at,
              'provider_updated_at', p_provider_updated_at,
              'provider_event_type', p_provider_event_type,
              'raw_status', p_raw_status
            ),
            updated_at = now()
        where id = v_existing.id;
        return 'CONFLICT';
      end if;

      if v_previous_at = p_provider_updated_at then
        if v_existing.status = v_status
          and v_existing.provider_charge_id is not distinct from p_provider_charge_id
          and v_existing.provider_payment_id is not distinct from p_provider_payment_id
          and v_existing.payment_id is not distinct from p_payment_id
          and v_existing.order_id is not distinct from p_order_id
          and v_existing.customer_id is not distinct from p_customer_id
          and v_existing.tailor_id is not distinct from p_tailor_id
          and v_existing.amount = p_amount
          and v_existing.currency = p_currency
          and v_existing.reason is not distinct from p_reason
          and v_existing.evidence_due_at is not distinct from p_evidence_due_at
          and v_existing.metadata ->> 'raw_status' is not distinct from p_raw_status then
          return 'DUPLICATE';
        end if;

        update public.provider_disputes
        set status = 'UNKNOWN',
            money_movement_blocked = true,
            closed_at = null,
            provider_event_id = p_provider_event_id,
            metadata = v_existing.metadata || jsonb_build_object(
              'chronology_conflict', true,
              'conflicting_event_id', p_provider_event_id,
              'conflicting_raw_status', p_raw_status,
              'provider_updated_at', p_provider_updated_at,
              'provider_event_type', p_provider_event_type,
              'raw_status', p_raw_status
            ),
            updated_at = now()
        where id = v_existing.id;
        return 'CONFLICT';
      end if;

      update public.provider_disputes
      set provider_charge_id = p_provider_charge_id,
          provider_payment_id = p_provider_payment_id,
          payment_id = p_payment_id,
          order_id = p_order_id,
          customer_id = p_customer_id,
          tailor_id = p_tailor_id,
          amount = p_amount,
          currency = p_currency,
          status = v_status,
          reason = p_reason,
          evidence_due_at = p_evidence_due_at,
          money_movement_blocked = v_blocked,
          provider_event_id = p_provider_event_id,
          metadata = v_metadata,
          closed_at = case when v_status in ('WON', 'LOST') then now() else null end,
          updated_at = now()
      where id = v_existing.id;
      return 'UPDATED';
    end if;

    insert into public.provider_disputes (
      provider, provider_dispute_id, provider_charge_id, provider_payment_id,
      payment_id, order_id, customer_id, tailor_id, amount, currency, status,
      reason, evidence_due_at, money_movement_blocked, provider_event_id,
      metadata, closed_at
    ) values (
      'BACHS'::public.payment_provider, p_provider_dispute_id,
      p_provider_charge_id, p_provider_payment_id, p_payment_id, p_order_id,
      p_customer_id, p_tailor_id, p_amount, p_currency, v_status, p_reason,
      p_evidence_due_at, v_blocked, p_provider_event_id, v_metadata,
      case when v_status in ('WON', 'LOST') then now() else null end
    ) on conflict (provider, provider_dispute_id) do nothing
    returning id into v_inserted_id;

    if v_inserted_id is not null then
      return 'INSERTED';
    end if;
    -- Another worker inserted the same dispute between SELECT and INSERT.
    -- Loop back and lock the now-existing row before comparing timestamps.
  end loop;
end;
$$;

revoke all on function public.record_bachs_provider_dispute_event(
  text, text, text, uuid, text, uuid, uuid, integer, public.currency,
  text, text, timestamptz, text, text, timestamptz, text, jsonb
) from public, anon, authenticated;
grant execute on function public.record_bachs_provider_dispute_event(
  text, text, text, uuid, text, uuid, uuid, integer, public.currency,
  text, text, timestamptz, text, text, timestamptz, text, jsonb
) to service_role;

comment on function public.record_bachs_provider_dispute_event(
  text, text, text, uuid, text, uuid, uuid, integer, public.currency,
  text, text, timestamptz, text, text, timestamptz, text, jsonb
) is 'Serializes signed Bachs dispute observations by provider timestamp; stale events are ignored and equal-time conflicts block settlement.';

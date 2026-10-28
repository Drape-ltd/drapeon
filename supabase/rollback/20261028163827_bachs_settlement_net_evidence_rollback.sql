-- Dev recorded the matching migration as version 20261028163827.
do $$
begin
  if exists (
    select 1 from public.provider_payment_settlement_checks
    where provider_webhook_event_id is not null
      or settlement_amount is not null
      or event_processing_fee_amount is not null
  ) then
    raise exception 'Cannot roll back Bachs net evidence after provider event evidence has been recorded';
  end if;
end;
$$;

revoke all on function public.record_bachs_payment_settlement_check_with_net(uuid, text, text, integer, currency, text, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.record_bachs_payment_settlement_event_evidence(uuid, text, integer, currency, integer, currency)
  from public, anon, authenticated, service_role;
drop function public.record_bachs_payment_settlement_check_with_net(uuid, text, text, integer, currency, text, timestamptz, timestamptz);
drop function public.record_bachs_payment_settlement_event_evidence(uuid, text, integer, currency, integer, currency);

grant execute on function public.record_bachs_payment_settlement_check(uuid, text, text, integer, currency, text, timestamptz, timestamptz)
  to service_role;

drop index public.provider_payment_settlement_checks_event_id_uidx;
alter table public.provider_payment_settlement_checks
  drop constraint provider_payment_settlement_final_net_evidence_check,
  drop column provider_webhook_event_id,
  drop column settlement_amount,
  drop column settlement_currency,
  drop column event_processing_fee_amount,
  drop column event_processing_fee_currency;

-- Read-only consistency test: purpose-level measurements must partition the
-- underlying payout rows exactly. Safe against Dev data and current DB guards.
begin;
set local role service_role;

do $test$
begin
  if exists (
    with expected as (
      select
        p.tailor_profile_id,
        p.provider,
        p.provider_destination_id,
        p.currency,
        coalesce(p.payout_purpose, 'UNKNOWN') as payout_purpose,
        count(*)::bigint as payout_record_count,
        coalesce(sum(p.amount) filter (where p.provider_transfer_status = 'NOT_STARTED'), 0)::bigint as transfer_not_started_minor,
        coalesce(sum(p.amount) filter (where p.provider_transfer_status = 'PROCESSING'), 0)::bigint as transfer_processing_minor,
        coalesce(sum(p.amount) filter (where p.provider_transfer_status = 'AVAILABLE_IN_PROVIDER_BALANCE'), 0)::bigint as transferred_to_provider_balance_minor,
        coalesce(sum(p.amount) filter (where p.provider_transfer_status = 'PAID_TO_BANK'), 0)::bigint as transferred_directly_to_bank_minor,
        coalesce(sum(p.amount) filter (where p.provider_transfer_status = 'FAILED'), 0)::bigint as transfer_failed_minor,
        coalesce(sum(p.amount) filter (where p.provider_transfer_status = 'REVERSED'), 0)::bigint as transfer_reversed_minor,
        count(*) filter (
          where p.provider_transfer_status not in (
            'NOT_STARTED', 'PROCESSING', 'AVAILABLE_IN_PROVIDER_BALANCE',
            'PAID_TO_BANK', 'FAILED', 'REVERSED'
          ) or p.provider_transfer_status is null
        )::bigint as transfer_status_unknown_count
      from public.payouts p
      group by p.tailor_profile_id, p.provider, p.provider_destination_id, p.currency,
        coalesce(p.payout_purpose, 'UNKNOWN')
    ),
    actual as (
      select
        tailor_profile_id,
        provider,
        provider_destination_id,
        currency,
        payout_purpose,
        payout_record_count,
        transfer_not_started_minor,
        transfer_processing_minor,
        transferred_to_provider_balance_minor,
        transferred_directly_to_bank_minor,
        transfer_failed_minor,
        transfer_reversed_minor,
        transfer_status_unknown_count
      from public.payout_account_purpose_movement_summary
    )
    select 1
    from expected e
    full outer join actual a
      on e.tailor_profile_id is not distinct from a.tailor_profile_id
      and e.provider is not distinct from a.provider
      and e.provider_destination_id is not distinct from a.provider_destination_id
      and e.currency is not distinct from a.currency
      and e.payout_purpose = a.payout_purpose
    where row(
      e.payout_record_count,
      e.transfer_not_started_minor,
      e.transfer_processing_minor,
      e.transferred_to_provider_balance_minor,
      e.transferred_directly_to_bank_minor,
      e.transfer_failed_minor,
      e.transfer_reversed_minor,
      e.transfer_status_unknown_count
    ) is distinct from row(
      a.payout_record_count,
      a.transfer_not_started_minor,
      a.transfer_processing_minor,
      a.transferred_to_provider_balance_minor,
      a.transferred_directly_to_bank_minor,
      a.transfer_failed_minor,
      a.transfer_reversed_minor,
      a.transfer_status_unknown_count
    )
  ) then
    raise exception 'Purpose-level payout movement does not exactly partition payouts';
  end if;

  if has_table_privilege('anon', 'public.payout_account_purpose_movement_summary', 'SELECT')
    or has_table_privilege('authenticated', 'public.payout_account_purpose_movement_summary', 'SELECT') then
    raise exception 'Purpose movement view must not be readable by public API roles';
  end if;
  if not has_table_privilege('service_role', 'public.payout_account_purpose_movement_summary', 'SELECT') then
    raise exception 'Ops service role must read the purpose movement view';
  end if;
end
$test$;

rollback;

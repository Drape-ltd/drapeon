-- Development-only repair for payment RLS tables introduced after the
-- STAFF_DRAFT claim-session boundary. The production-forward migration must
-- generate this policy for every public RLS table from the release catalog.
do $policy$
declare
  target text;
begin
  foreach target in array array[
    'order_payment_provider_refunds',
    'payment_late_success_refund_operations',
    'payment_status_transition_audits'
  ]
  loop
    -- The isolated claim-email proof intentionally contains no payments schema.
    -- Development has these tables; a future full schema proof covers their RLS.
    if to_regclass(format('public.%I', target)) is null then
      continue;
    end if;

    if not exists (
      select 1
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = target
        and relation.relrowsecurity
    ) then
      raise exception 'STAFF_DRAFT_DENY_POLICY_REQUIRES_RLS:%', target;
    end if;

    execute format('drop policy if exists deny_staff_draft_claim_session on public.%I', target);
    execute format(
      'create policy deny_staff_draft_claim_session on public.%I as restrictive for all to authenticated using (not public.is_staff_draft_identity()) with check (not public.is_staff_draft_identity())',
      target
    );
  end loop;
end
$policy$;

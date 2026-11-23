-- Bounded, service-only selector for settlement milestones whose evidence window
-- has elapsed. It never reserves a payout or invokes a provider.
alter table public.order_settlement_plans
  add column last_eligibility_scan_at timestamptz;

create index order_settlement_plans_eligibility_scan_idx
  on public.order_settlement_plans (last_eligibility_scan_at nulls first, created_at, id)
  where status in ('ACTIVE', 'FROZEN');

-- Return only missing cases or unresolved cases that must move to a higher
-- severity. A resolved case is never re-opened by the scheduled scan.
create or replace function public.list_due_settlement_eligibility_tranches(p_plan_id uuid)
returns table (
  id uuid,
  code text,
  amount integer,
  currency public.currency,
  status text,
  eligible_at timestamptz,
  needs_notice boolean
)
language sql stable security definer set search_path = public, extensions as $$
  select t.id, t.code, t.amount, t.currency, t.status, t.eligible_at,
    (i.dedupe_key is null) as needs_notice
  from public.order_settlement_tranches t
  left join public.ops_issues i
    on i.dedupe_key = 'settlement-eligible:' || t.id::text
  where t.plan_id = p_plan_id
    and t.status in ('ELIGIBLE', 'RELEASE_REQUESTED')
    and (
      i.dedupe_key is null
      or (
        i.status not in ('RESOLVED', 'CLOSED')
        and i.canonical_status not in ('RESOLVED', 'CLOSED')
        and (
          (t.eligible_at <= now() - interval '24 hours' and i.severity <> 'CRITICAL')
          or (t.eligible_at <= now() - interval '4 hours'
            and i.severity not in ('HIGH', 'CRITICAL'))
        )
      )
    )
$$;

create or replace function public.list_due_settlement_eligibility_plans(p_limit integer default 100)
returns table (
  id uuid,
  order_id text,
  tailor_id uuid,
  customer_id uuid,
  currency public.currency,
  status text
)
language sql stable security definer set search_path = public, extensions as $$
  select p.id, p.order_id, p.tailor_id, p.customer_id, p.currency, p.status
  from public.order_settlement_plans p
  where p.status in ('ACTIVE', 'FROZEN')
    and (
      exists (
        select 1
        from public.order_settlement_tranches t
        where t.plan_id = p.id
        and (
          (p.status = 'FROZEN' and t.status = 'BLOCKED'
            and t.blocked_reason = 'OPEN_REVIEW')
          or
          (t.status = 'LOCKED' and exists (
            select 1
            from public.order_settlement_evidence e
            where e.plan_id = p.id
              and (
                (t.code = 'SHIP_CUSTODY_70'
                  and e.evidence_kind in ('DRAPEON_CUSTODY', 'CARRIER_ACCEPTED')
                  and e.occurred_at <= now())
                or (t.code = 'SHIP_DELIVERY_20'
                  and e.evidence_kind = 'VERIFIED_DELIVERY'
                  and e.occurred_at <= now() - interval '72 hours')
                or (t.code = 'SHIP_PROTECTION_10'
                  and e.evidence_kind = 'VERIFIED_DELIVERY'
                  and e.occurred_at <= now() - interval '14 days')
                or (t.code = 'LOCAL_HANDOFF_80'
                  and e.evidence_kind = 'AUTHENTICATED_LOCAL_HANDOFF'
                  and e.occurred_at <= now())
                or (t.code = 'LOCAL_SETTLED_20'
                  and e.evidence_kind = 'AUTHENTICATED_LOCAL_HANDOFF'
                  and e.occurred_at <= now() - interval '72 hours')
              )
          ))
        )
      )
      or exists (
        select 1 from public.list_due_settlement_eligibility_tranches(p.id)
      )
    )
  order by p.last_eligibility_scan_at nulls first, p.created_at, p.id
  limit least(greatest(coalesce(p_limit, 100), 1), 100)
$$;

revoke all on function public.list_due_settlement_eligibility_plans(integer)
  from public, anon, authenticated;
revoke all on function public.list_due_settlement_eligibility_tranches(uuid)
  from public, anon, authenticated;
grant execute on function public.list_due_settlement_eligibility_plans(integer)
  to service_role;
grant execute on function public.list_due_settlement_eligibility_tranches(uuid)
  to service_role;

comment on function public.list_due_settlement_eligibility_plans(integer) is
  'Service-only bounded scan for due settlement eligibility and missing or under-severity open Ops cases. Does not release funds.';

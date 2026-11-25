-- #305 batch 7: preserve the live Production predicates while initializing
-- auth.uid() once per statement. Public policies are narrowed to authenticated
-- only where every branch requires auth.uid(). Cross-project ID drift is
-- normalized with ::text on both sides where Production and Dev differ.

alter policy "Order parties read commercial adjustments"
on public.commercial_adjustments
to authenticated
using (
  customer_id = (select auth.uid())::text
  or tailor_id = (select auth.uid())::text
);

alter policy "consultation_reschedule_participants_select"
on public.consultation_reschedule_requests
to authenticated
using (
  exists (
    select 1
    from public.orders order_record
    where order_record.id::text = consultation_reschedule_requests.order_id::text
      and (
        order_record.customer_id::text = (select auth.uid())::text
        or order_record.tailor_id::text = (select auth.uid())::text
      )
  )
);

alter policy "Order participants view material advances"
on public.order_material_advances
to authenticated
using (
  customer_id = (select auth.uid())
  or tailor_id = (select auth.uid())
);

alter policy "Order participants view payment attempts"
on public.order_payments
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.id::text = order_payments.order_id::text
      and (
        o.customer_id::text = (select auth.uid())::text
        or o.tailor_id::text = (select auth.uid())::text
      )
  )
);

alter policy "order_production_evidence: participants can view"
on public.order_production_evidence
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.id::text = order_production_evidence.order_id::text
      and (
        o.customer_id::text = (select auth.uid())::text
        or o.tailor_id::text = (select auth.uid())::text
      )
  )
);

alter policy "order_quotes: participants can view"
on public.order_quotes
to authenticated
using (
  exists (
    select 1
    from public.orders order_row
    where order_row.id::text = order_quotes.order_id::text
      and (
        order_row.customer_id::text = (select auth.uid())::text
        or order_row.tailor_id::text = (select auth.uid())::text
      )
  )
);

alter policy "return_parties_read"
on public.order_return_requests
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.id::text = order_return_requests.order_id::text
      and (
        o.customer_id::text = (select auth.uid())::text
        or o.tailor_id::text = (select auth.uid())::text
      )
  )
);

alter policy "settlement_plans_parties_read"
on public.order_settlement_plans
to authenticated
using (
  customer_id = (select auth.uid())
  or tailor_id = (select auth.uid())
);

alter policy "order_tips_parties_read"
on public.order_tips
to authenticated
using (
  customer_id = (select auth.uid())
  or tailor_id = (select auth.uid())
);

alter policy "payout change requests: owner can read"
on public.payout_change_requests
to authenticated
using (tailor_user_id = (select auth.uid()));

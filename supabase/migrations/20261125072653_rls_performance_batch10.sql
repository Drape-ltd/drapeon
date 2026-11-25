-- #305 batch 10: preserve live Production access while initializing auth.uid()
-- once per statement. All ten live policies already target authenticated.

alter policy "fulfillment_runs_parties_read"
on public.order_fulfillment_runs
using (
  exists (
    select 1 from public.orders o
    where o.id::text = order_fulfillment_runs.order_id::text
      and (
        (select auth.uid())::text = o.customer_id::text
        or (select auth.uid())::text = o.tailor_id::text
      )
  )
);

alter policy "fabric candidates participants view"
on public.order_fabric_candidates
using (
  customer_id = (select auth.uid())::text
  or tailor_id = (select auth.uid())::text
);

alter policy "settlement_tranches_parties_read"
on public.order_settlement_tranches
using (
  exists (
    select 1 from public.order_settlement_plans p
    where p.id = order_settlement_tranches.plan_id
      and (
        p.customer_id = (select auth.uid())
        or p.tailor_id = (select auth.uid())
      )
  )
);

alter policy "refund_resolution_parties_read"
on public.order_refund_resolutions
using (
  exists (
    select 1 from public.orders o
    where o.id::text = order_refund_resolutions.order_id::text
      and (
        (select auth.uid())::text = o.customer_id::text
        or (select auth.uid())::text = o.tailor_id::text
      )
  )
);

alter policy "fabric handoffs participants view"
on public.order_fabric_handoffs
using (
  customer_id = (select auth.uid())::text
  or tailor_id = (select auth.uid())::text
);

alter policy "fulfillment_events_parties_read"
on public.order_fulfillment_events
using (
  exists (
    select 1 from public.orders o
    where o.id::text = order_fulfillment_events.order_id::text
      and (
        (select auth.uid())::text = o.customer_id::text
        or (select auth.uid())::text = o.tailor_id::text
      )
  )
);

alter policy "Order parties read consultation attendance evidence"
on public.consultation_attendance_evidence
using (
  exists (
    select 1 from public.orders o
    where o.id_text = consultation_attendance_evidence.order_id
      and (
        o.customer_id::text = (select auth.uid())::text
        or o.tailor_id::text = (select auth.uid())::text
      )
  )
);

alter policy "fulfillment_parcels_parties_read"
on public.order_fulfillment_parcels
using (
  exists (
    select 1 from public.orders o
    where o.id::text = order_fulfillment_parcels.order_id::text
      and (
        (select auth.uid())::text = o.customer_id::text
        or (select auth.uid())::text = o.tailor_id::text
      )
  )
);

alter policy "commercial receipts: order parties can view"
on public.commercial_receipts
using (
  customer_id = (select auth.uid())::text
  or tailor_id = (select auth.uid())::text
);

alter policy "owners read their Studio collection"
on public.studio_collections
using (owner_id = (select auth.uid()));

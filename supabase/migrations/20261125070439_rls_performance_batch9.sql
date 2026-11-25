-- #305 batch 9: preserve live Production access while initializing auth.uid()
-- once per statement. Public policies are narrowed to authenticated because
-- every branch requires auth.uid(). Drifted IDs are compared as text.

alter policy "Order parties read consultation commercial events"
on public.consultation_commercial_events
to authenticated
using (
  exists (
    select 1 from public.orders order_record
    where order_record.id::text = consultation_commercial_events.order_id::text
      and (
        order_record.customer_id::text = (select auth.uid())::text
        or order_record.tailor_id::text = (select auth.uid())::text
      )
  )
);

alter policy "Customer owns their Drape Vision ground truth"
on public.drape_vision_ground_truth
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

alter policy "Customer owns their Drape Vision scorecard rows"
on public.drape_vision_scorecard_rows
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

alter policy "Order parties see call participation"
on public.order_call_participations
to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id::text = order_call_participations.order_id::text
      and (
        o.customer_id::text = (select auth.uid())::text
        or o.tailor_id::text = (select auth.uid())::text
        or exists (
          select 1 from public.tailor_profiles tp
          where tp.id::text = o.tailor_profile_id::text
            and tp.user_id::text = (select auth.uid())::text
        )
      )
  )
);

alter policy "Users delete own product feedback"
on public.product_feedback
to authenticated
using ((select auth.uid()) = user_id);

alter policy "Users insert own product feedback"
on public.product_feedback
to authenticated
with check (
  (select auth.uid()) = user_id
  and (
    measurement_scan_id is null
    or exists (
      select 1 from public.measurement_scans scan
      where scan.id = product_feedback.measurement_scan_id
        and scan.user_id = (select auth.uid())
    )
  )
  and (
    order_id is null
    or exists (
      select 1 from public.orders feedback_order
      where feedback_order.id::text = product_feedback.order_id::text
        and (
          feedback_order.customer_id::text = (select auth.uid())::text
          or feedback_order.tailor_id::text = (select auth.uid())::text
          or exists (
            select 1 from public.tailor_profiles feedback_tailor
            where feedback_tailor.id::text = feedback_order.tailor_profile_id::text
              and feedback_tailor.user_id::text = (select auth.uid())::text
          )
        )
    )
  )
);

alter policy "Users select own product feedback"
on public.product_feedback
to authenticated
using ((select auth.uid()) = user_id);

alter policy "proposal_parties_read"
on public.order_resolution_proposals
to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id::text = order_resolution_proposals.order_id::text
      and (
        o.customer_id::text = (select auth.uid())::text
        or o.tailor_id::text = (select auth.uid())::text
      )
  )
);

alter policy "settlement_evidence_parties_read"
on public.order_settlement_evidence
to authenticated
using (
  exists (
    select 1 from public.order_settlement_plans p
    where p.id = order_settlement_evidence.plan_id
      and (
        p.customer_id = (select auth.uid())
        or p.tailor_id = (select auth.uid())
      )
  )
);

alter policy "tailor_payout_setup_requests: own row select"
on public.tailor_payout_setup_requests
to authenticated
using (user_id::text = (select auth.uid())::text);

alter policy "decision_parties_read"
on public.order_resolution_decisions
to authenticated
using (
  exists (
    select 1
    from public.order_return_requests r
    join public.orders o on o.id::text = r.order_id::text
    where r.id = order_resolution_decisions.return_request_id
      and (
        o.customer_id::text = (select auth.uid())::text
        or o.tailor_id::text = (select auth.uid())::text
      )
  )
);

alter policy "provider_payout_events_tailor_read"
on public.provider_payout_events
to authenticated
using (
  exists (
    select 1 from public.tailor_profiles tp
    where tp.id::text = provider_payout_events.tailor_profile_id::text
      and tp.user_id::text = (select auth.uid())::text
  )
);

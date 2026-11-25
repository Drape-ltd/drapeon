-- #305 batch 11: clear the remaining Production auth_rls_initplan findings
-- while preserving each live predicate. Drifted IDs compare through text.

alter policy "Order parties read commercial adjustment events"
on public.commercial_adjustment_events
using (
  visibility = 'PARTIES'
  and exists (
    select 1 from public.commercial_adjustments a
    where a.id = commercial_adjustment_events.adjustment_id
      and (
        a.customer_id = (select auth.uid())::text
        or a.tailor_id = (select auth.uid())::text
      )
  )
);

alter policy "Order parties read consultation booking slots"
on public.consultation_booking_slots
to authenticated
using (
  exists (
    select 1
    from public.consultation_bookings booking
    join public.orders order_record
      on order_record.id::text = booking.order_id::text
    where booking.id = consultation_booking_slots.booking_id
      and (
        order_record.customer_id::text = (select auth.uid())::text
        or order_record.tailor_id::text = (select auth.uid())::text
      )
  )
);

alter policy "Diary photos: tailor adds own"
on public.diary_attachments
with check (
  tailor_id = (select auth.uid())
  and exists (
    select 1 from public.diary_entries d
    where d.id = diary_attachments.entry_id
      and d.tailor_id = (select auth.uid())
  )
);

alter policy "Diary photos: tailor reads own"
on public.diary_attachments
using (
  tailor_id = (select auth.uid())
  and exists (
    select 1 from public.diary_entries d
    where d.id = diary_attachments.entry_id
      and d.tailor_id = (select auth.uid())
  )
);

alter policy "Diary photos: tailor removes own"
on public.diary_attachments
using (tailor_id = (select auth.uid()));

alter policy "fabric adjustment links: participants can view"
on public.fabric_release_adjustment_links
using (
  exists (
    select 1 from public.orders o
    where o.id::text = fabric_release_adjustment_links.order_id::text
      and (
        o.customer_id::text = (select auth.uid())::text
        or o.tailor_id::text = (select auth.uid())::text
      )
  )
);

alter policy "Order parties read visible financial case events"
on public.financial_case_events
using (
  visibility = 'PARTIES'
  and exists (
    select 1
    from public.financial_cases fc
    join public.orders o on o.id_text = fc.order_id
    where fc.id = financial_case_events.case_id
      and (
        o.customer_id::text = (select auth.uid())::text
        or o.tailor_id::text = (select auth.uid())::text
      )
  )
);

alter policy "Order parties read visible financial case evidence"
on public.financial_case_evidence
using (
  visibility = 'PARTIES'
  and exists (
    select 1
    from public.financial_cases fc
    join public.orders o on o.id_text = fc.order_id
    where fc.id = financial_case_evidence.case_id
      and (
        o.customer_id::text = (select auth.uid())::text
        or o.tailor_id::text = (select auth.uid())::text
      )
  )
);

alter policy "Order parties see call sessions"
on public.order_call_sessions
to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id::text = order_call_sessions.order_id::text
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

alter policy "fabric events participants view"
on public.order_fabric_events
using (
  exists (
    select 1 from public.orders o
    where o.id::text = order_fabric_events.order_id::text
      and (
        o.customer_id::text = (select auth.uid())::text
        or o.tailor_id::text = (select auth.uid())::text
      )
  )
);

alter policy "return_shipment_event_parties_read"
on public.order_return_shipment_events
using (
  exists (
    select 1
    from public.order_return_requests r
    join public.orders o on o.id::text = r.order_id::text
    where r.id = order_return_shipment_events.return_request_id
      and (
        (select auth.uid())::text = o.customer_id::text
        or (select auth.uid())::text = o.tailor_id::text
      )
  )
);

alter policy "return_shipment_parties_read"
on public.order_return_shipments
using (
  exists (
    select 1 from public.orders o
    where o.id::text = order_return_shipments.order_id::text
      and (
        (select auth.uid())::text = o.customer_id::text
        or (select auth.uid())::text = o.tailor_id::text
      )
  )
);

alter policy "settlement_events_parties_read"
on public.order_settlement_events
using (
  exists (
    select 1 from public.order_settlement_plans p
    where p.id = order_settlement_events.plan_id
      and (
        p.customer_id = (select auth.uid())
        or p.tailor_id = (select auth.uid())
      )
  )
);

alter policy "Order participants can read Studio design versions"
on public.order_studio_design_versions
using (
  exists (
    select 1 from public.orders o
    where o.id::text = order_studio_design_versions.order_id::text
      and (
        o.customer_id::text = (select auth.uid())::text
        or o.tailor_id::text = (select auth.uid())::text
      )
  )
);

alter policy "order_tip_events_parties_read"
on public.order_tip_events
using (
  exists (
    select 1 from public.order_tips t
    where t.id = order_tip_events.tip_id
      and (
        t.customer_id = (select auth.uid())
        or t.tailor_id = (select auth.uid())
      )
  )
);

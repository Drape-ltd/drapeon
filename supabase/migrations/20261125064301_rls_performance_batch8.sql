-- #305 batch 8: preserve the live Production access predicates while
-- initializing auth.uid() once per statement. Policies addressed to public
-- are narrowed to authenticated only when every branch requires auth.uid().
-- Cross-project ID drift is normalized with ::text on both sides.

alter policy "commercial_redemptions_owner_read"
on public.commercial_benefit_redemptions
to authenticated
using (customer_id = (select auth.uid()));

alter policy "commercial_reservations_owner_read"
on public.commercial_benefit_reservations
to authenticated
using (customer_id = (select auth.uid()));

alter policy "commercial_grants_owner_read"
on public.commercial_grants
to authenticated
using (user_id = (select auth.uid()));

alter policy "Order parties read consultation attendance reviews"
on public.consultation_attendance_reviews
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.id_text = consultation_attendance_reviews.order_id
      and (
        o.customer_id::text = (select auth.uid())::text
        or o.tailor_id::text = (select auth.uid())::text
      )
  )
);

alter policy "Customer owns their Drape Vision scan logs"
on public.drape_vision_scan_logs
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

alter policy "Order parties read financial cases"
on public.financial_cases
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.id_text = financial_cases.order_id
      and (
        o.customer_id::text = (select auth.uid())::text
        or o.tailor_id::text = (select auth.uid())::text
      )
  )
);

alter policy "Order parties add own message reactions"
on public.message_reactions
to authenticated
with check (
  user_id::text = (select auth.uid())::text
  and exists (
    select 1
    from public.messages m
    join public.orders o on o.id::text = m.order_id::text
    where m.id::text = message_reactions.message_id::text
      and m.order_id::text = message_reactions.order_id::text
      and (
        o.customer_id::text = (select auth.uid())::text
        or o.tailor_id::text = (select auth.uid())::text
        or exists (
          select 1
          from public.tailor_profiles tp
          where tp.id::text = o.tailor_profile_id::text
            and tp.user_id::text = (select auth.uid())::text
        )
      )
  )
);

alter policy "Order parties see message reactions"
on public.message_reactions
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.id::text = message_reactions.order_id::text
      and (
        o.customer_id::text = (select auth.uid())::text
        or o.tailor_id::text = (select auth.uid())::text
        or exists (
          select 1
          from public.tailor_profiles tp
          where tp.id::text = o.tailor_profile_id::text
            and tp.user_id::text = (select auth.uid())::text
        )
      )
  )
);

alter policy "Users remove own message reactions"
on public.message_reactions
to authenticated
using (user_id::text = (select auth.uid())::text);

alter policy "fabric allocations: participants can view"
on public.order_fabric_funding_allocations
to authenticated
using (
  customer_id = (select auth.uid())::text
  or tailor_id = (select auth.uid())::text
);

alter policy "provider_disputes_parties_read"
on public.provider_disputes
to authenticated
using (
  customer_id = (select auth.uid())
  or tailor_id = (select auth.uid())
);

-- Dev has a redundant legacy policy with the same owner predicate. Removing it
-- preserves access and aligns Dev policy inventory with Production.
drop policy if exists "tailors: manage own client notes"
on public.tailor_client_notes;

alter policy "Tailor owns their client notes"
on public.tailor_client_notes
to authenticated
using (tailor_id::text = (select auth.uid())::text)
with check (tailor_id::text = (select auth.uid())::text);

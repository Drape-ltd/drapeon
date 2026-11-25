-- #305 batch 6: preserve the live Production predicates while initializing
-- auth.uid() once per statement. Policies formerly addressed to public are
-- narrowed to authenticated where every branch requires auth.uid().

alter policy "Customers manage own measurement profiles"
on public.customer_measurement_profiles
to authenticated
using (customer_id = (select auth.uid()))
with check (customer_id = (select auth.uid()));

alter policy "customers manage own wishlist items"
on public.wishlist_items
to authenticated
using (
  exists (
    select 1
    from public.wishlist_collections wc
    where wc.id = wishlist_items.collection_id
      and wc.customer_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.wishlist_collections wc
    where wc.id = wishlist_items.collection_id
      and wc.customer_id = (select auth.uid())
  )
);

alter policy "Order parties see call rooms"
on public.order_call_rooms
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.id::text = order_call_rooms.order_id::text
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

alter policy "Customer owns their measurement scans"
on public.measurement_scans
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

alter policy "customers manage own wishlist collections"
on public.wishlist_collections
to authenticated
using ((select auth.uid()) = customer_id)
with check ((select auth.uid()) = customer_id);

alter policy "Tailors view own data export requests"
on public.tailor_data_exports
to authenticated
using (tailor_user_id = (select auth.uid()));

alter policy "tailors read own quote drafts"
on public.tailor_quote_drafts
to authenticated
using (tailor_id = (select auth.uid()));

alter policy "order_handoff_issues: participant select"
on public.order_handoff_issues
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.id::text = order_handoff_issues.order_id::text
      and (
        o.customer_id::text = (select auth.uid())::text
        or o.tailor_id::text = (select auth.uid())::text
      )
  )
);

alter policy "quote_revision_requests: participants can view"
on public.quote_revision_requests
to authenticated
using (
  exists (
    select 1
    from public.orders order_row
    where order_row.id::text = quote_revision_requests.order_id::text
      and (
        order_row.customer_id::text = (select auth.uid())::text
        or order_row.tailor_id::text = (select auth.uid())::text
      )
  )
);

alter policy "order_events: participants can view"
on public.order_events
to authenticated
using (
  exists (
    select 1
    from public.orders order_row
    where order_row.id::text = order_events.order_id::text
      and (
        order_row.customer_id::text = (select auth.uid())::text
        or order_row.tailor_id::text = (select auth.uid())::text
      )
  )
);

-- #305 batch 5: preserve the live Production predicates while initializing
-- auth.uid() once per statement. Policies that previously targeted public are
-- narrowed to authenticated only where auth.uid() made the anon branch empty.

alter policy "communication_inbox_own_read"
on public.communication_inbox
to authenticated
using (recipient_id = (select auth.uid()));

alter policy "Users can view their own profile"
on public.users
to authenticated
using (id::text = (select auth.uid())::text);

alter policy "Users can update their own profile"
on public.users
to authenticated
using (id::text = (select auth.uid())::text)
with check (id::text = (select auth.uid())::text);

alter policy "identity handoffs: owner can read status"
on public.identity_verification_handoffs
to authenticated
using (tailor_user_id = (select auth.uid()));

alter policy "Users view their own referral links"
on public.referrals
to authenticated
using (
  referrer_user_id = (select auth.uid())
  or referred_user_id = (select auth.uid())
);

alter policy "Users create their own referrals"
on public.referrals
to authenticated
with check (referrer_user_id = (select auth.uid()));

alter policy "customers read own custom order drafts"
on public.custom_order_brief_drafts
to authenticated
using (customer_id = (select auth.uid()));

alter policy "identity consents: owner can read"
on public.identity_verification_consents
to authenticated
using (tailor_user_id = (select auth.uid()));

alter policy "identity retention: owner can read"
on public.identity_retention_records
to authenticated
using (tailor_user_id = (select auth.uid()));

alter policy "custom_order_details: participants can view"
on public.custom_order_details
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.id::text = custom_order_details.order_id::text
      and (
        o.customer_id::text = (select auth.uid())::text
        or o.tailor_id::text = (select auth.uid())::text
      )
  )
);

alter policy "profile change requests: owner can read"
on public.profile_change_requests
to authenticated
using (tailor_user_id = (select auth.uid()));

alter policy "Order parties read consultation bookings"
on public.consultation_bookings
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.id::text = consultation_bookings.order_id::text
      and (
        o.customer_id::text = (select auth.uid())::text
        or o.tailor_id::text = (select auth.uid())::text
      )
  )
);

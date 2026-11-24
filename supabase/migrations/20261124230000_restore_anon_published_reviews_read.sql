-- Forward fix for 20261124211043_rls_performance_batch2.
-- That batch merged the public "published reviews" SELECT policy with the
-- order-party branches into one policy for role `public`. The order-party
-- branch reads public.orders, which anon cannot SELECT, so every anonymous
-- reviews read failed with 42501 instead of returning published reviews.
--
-- Split by role again (no multiple-permissive overlap, since the roles differ):
--   anon          -> published, unflagged reviews only (no orders lookup)
--   authenticated -> published OR own order OR own tailor review

drop policy if exists "Published or order-party reviews are readable" on public.reviews;
drop policy if exists "Published reviews are public" on public.reviews;
drop policy if exists "Signed-in readers see published or own order reviews" on public.reviews;

create policy "Published reviews are public"
on public.reviews for select to anon
using (published_at is not null and flagged = false);

create policy "Signed-in readers see published or own order reviews"
on public.reviews for select to authenticated
using (
  (published_at is not null and flagged = false)
  or exists (
    select 1
    from public.orders o
    where o.id::text = reviews.order_id::text
      and o.customer_id::text = (select auth.uid())::text
  )
  or (
    tailor_id is not null
    and tailor_id::text = (select auth.uid())::text
  )
);

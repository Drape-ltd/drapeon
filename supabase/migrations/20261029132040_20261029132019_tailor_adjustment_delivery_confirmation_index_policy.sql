-- Keep order-scoped lookups efficient and avoid per-row auth function evaluation.
create index if not exists tailor_adjustment_delivery_confirmations_order_id_idx
  on public.tailor_adjustment_delivery_confirmations(order_id);

drop policy if exists "Order parties read tailor adjustment delivery confirmations"
  on public.tailor_adjustment_delivery_confirmations;
create policy "Order parties read tailor adjustment delivery confirmations"
  on public.tailor_adjustment_delivery_confirmations for select to authenticated
  using (exists (
    select 1 from public.commercial_adjustments a
      where a.id = tailor_adjustment_delivery_confirmations.adjustment_id
        and a.order_id = tailor_adjustment_delivery_confirmations.order_id
        and (a.customer_id = (select auth.uid())::text
          or a.tailor_id = (select auth.uid())::text)
  ));

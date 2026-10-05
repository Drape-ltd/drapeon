-- Keep the revised sheet in the order conversation, and invalidate the previous
-- style/fabric decisions when a new customer design supersedes them.
create or replace function public.append_order_studio_revision(
  p_order_id text,
  p_expected_version integer,
  p_actor_id uuid,
  p_design jsonb,
  p_sheet_photo_url text,
  p_note text,
  p_colour_changed boolean
) returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_latest integer;
  v_next integer;
  v_meta jsonb;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.customer_id::text <> p_actor_id::text or v_order.order_kind::text <> 'CUSTOM' then
    raise exception 'Studio revision is unavailable for this order' using errcode = 'P0001';
  end if;
  if v_order.stage::text not in ('PENDING_QUOTE','CONSULTATION','QUOTE_SENT','PAYMENT_PENDING','CONFIRMED','DESIGNING','SOURCING') then
    raise exception 'The order has passed the pre-cutting revision stage' using errcode = 'P0001';
  end if;
  select coalesce(max(version), 0) into v_latest from public.order_studio_design_versions where order_id = p_order_id;
  if v_latest = 0 or v_latest <> p_expected_version then
    raise exception 'The Studio design changed. Reopen the latest version before saving.' using errcode = 'P0001';
  end if;
  v_next := v_latest + 1;

  insert into public.order_studio_design_versions (order_id, version, authored_by, design, sheet_photo_url)
  values (p_order_id, v_next, p_actor_id, p_design, p_sheet_photo_url);

  v_meta := coalesce(nullif(v_order.special_note, '')::jsonb, '{}'::jsonb);
  v_meta := jsonb_set(v_meta, '{styleAlignment}',
    coalesce(v_meta->'styleAlignment', '{}'::jsonb) || jsonb_build_object(
      'requiredBeforeCutting', true,
      'status', 'NEEDS_TAILOR_CONFIRMATION',
      'studioVersion', v_next,
      'tailorInterpretation', null,
      'proposalPhotoUrl', null,
      'approvalRequestedAt', null,
      'approvedAt', null,
      'changeRequestedAt', null
    ), true);
  update public.orders set special_note = v_meta::text where id = p_order_id;

  if p_colour_changed then
    update public.custom_order_details
      set fabric_approval_status = 'CHANGES_REQUESTED',
          fabric_approved_at = null,
          fabric_changes_requested_at = now(),
          updated_at = now()
      where order_id = p_order_id
        and fabric_approval_required = true
        and fabric_approval_status in ('APPROVED', 'PENDING_CUSTOMER_APPROVAL');
  end if;

  insert into public.messages (order_id, sender_id, sender_role, type, body, photo_url)
  values (p_order_id, p_actor_id, 'CUSTOMER', 'TEXT',
    'Studio design updated to version ' || v_next || '. ' || p_note,
    p_sheet_photo_url);
  insert into public.order_stage_updates (order_id, stage, note, photo_url)
  values (p_order_id, v_order.stage,
    'Customer updated Studio design to version ' || v_next || ': ' || p_note,
    p_sheet_photo_url);
  return v_next;
end;
$$;

revoke all on function public.append_order_studio_revision(text, integer, uuid, jsonb, text, text, boolean) from public, anon, authenticated;
grant execute on function public.append_order_studio_revision(text, integer, uuid, jsonb, text, text, boolean) to service_role;

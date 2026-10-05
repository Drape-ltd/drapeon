-- A tailor's style proposal must appear in the approval gate, order history,
-- and conversation together. Keep the caller check in the Edge Function and
-- repeat it here under the order lock so concurrent revisions cannot race.
create or replace function public.request_style_alignment_with_proposal(
  p_order_id text,
  p_actor_id uuid,
  p_note text,
  p_photo_url text,
  p_expected_studio_version integer
) returns timestamptz
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_latest_studio_version integer;
  v_meta jsonb;
  v_alignment jsonb;
  v_requested_at timestamptz := now();
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.tailor_id::text <> p_actor_id::text or v_order.order_kind::text <> 'CUSTOM' then
    raise exception 'Style approval is unavailable for this order' using errcode = 'P0001';
  end if;
  if v_order.stage::text not in ('PENDING_QUOTE','CONSULTATION','QUOTE_SENT','PAYMENT_PENDING','CONFIRMED','DESIGNING','SOURCING') then
    raise exception 'This order has passed pre-cutting style approval' using errcode = 'P0001';
  end if;
  if length(trim(p_note)) < 10 or length(trim(p_note)) > 500 then
    raise exception 'Explain the style interpretation in 10 to 500 characters' using errcode = 'P0001';
  end if;
  select max(version) into v_latest_studio_version
    from public.order_studio_design_versions where order_id = p_order_id;
  if v_latest_studio_version is distinct from p_expected_studio_version then
    raise exception 'The Studio design changed. Reopen the latest version before requesting approval.' using errcode = 'P0001';
  end if;

  begin
    v_meta := coalesce(nullif(v_order.special_note, '')::jsonb, '{}'::jsonb);
    if jsonb_typeof(v_meta) <> 'object' then v_meta := '{}'::jsonb; end if;
  exception when invalid_text_representation then
    v_meta := '{}'::jsonb;
  end;
  v_alignment := v_meta->'styleAlignment';
  if v_alignment is null or jsonb_typeof(v_alignment) <> 'object' then v_alignment := '{}'::jsonb; end if;
  v_alignment := v_alignment || jsonb_build_object(
    'requiredBeforeCutting', true,
    'studioVersion', v_latest_studio_version,
    'status', 'PENDING_CUSTOMER_APPROVAL',
    'tailorInterpretation', trim(p_note),
    'proposalPhotoUrl', p_photo_url,
    'approvalRequestedAt', v_requested_at
  );
  v_alignment := v_alignment || jsonb_build_object(
    'instruction', coalesce(v_alignment->>'instruction',
      'Before cutting, confirm what can and cannot be matched from the customer references inside Drapeon.'),
    'customerExpectation', coalesce(v_alignment->>'customerExpectation',
      'Reference photos guide the garment. Exact replication depends on fabric, budget, measurements, and agreed finish.')
  );
  update public.orders set special_note = jsonb_set(v_meta, '{styleAlignment}', v_alignment, true)::text
    where id = p_order_id;

  insert into public.order_stage_updates (order_id, stage, note, photo_url)
  values (p_order_id, v_order.stage,
    'Tailor requested style approval before cutting: ' || trim(p_note), p_photo_url);
  insert into public.messages (order_id, sender_id, sender_role, type, body, photo_url)
  values (p_order_id, p_actor_id, 'TAILOR', 'TEXT',
    'Style plan sent for approval: ' || trim(p_note), p_photo_url);
  return v_requested_at;
end;
$$;

revoke all on function public.request_style_alignment_with_proposal(text, uuid, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.request_style_alignment_with_proposal(text, uuid, text, text, integer)
  to service_role;

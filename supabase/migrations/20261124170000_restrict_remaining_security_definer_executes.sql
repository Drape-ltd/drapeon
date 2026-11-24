-- Issue #295: make every remaining Production SECURITY DEFINER execute grant explicit.
--
-- Production is ahead of Development for several routines. Using to_regprocedure
-- keeps this forward migration safe in Development while still hardening every
-- signature when it reaches an environment where that signature exists.
do $migration$
declare
  signature text;
  routine regprocedure;
  service_or_trigger_signatures constant text[] := array[
    'public.audit_measurement_scan_change()',
    'public.capture_public_marketplace_visibility_change()',
    'public.cleanup_terminal_tailor_claim_provider_identity()',
    'public.compute_tailor_profile_completed()',
    'public.compute_tailor_ranking_score()',
    'public.enqueue_welcome_after_user_created()',
    'public.get_order_fabric_cutting_blockers_v2(text)',
    'public.handle_new_user()',
    'public.increment_tailor_total_orders()',
    'public.lock_fabric_allocation_on_quote_acceptance()',
    'public.prepare_account_phone()',
    'public.prepare_customer_profile_phone()',
    'public.record_dispatch_method_stage_transition()',
    'public.record_public_visibility_tombstone(text,uuid,text,text,jsonb)',
    'public.refresh_wishlist_collection_summary(uuid)',
    'public.refresh_wishlist_collection_summary_trigger()',
    'public.rls_auto_enable()',
    'public.set_review_published_at()',
    'public.sync_financial_case_from_legacy_dispute()',
    'public.sync_public_user_email_after_auth_change()',
    'public.sync_settlement_evidence_from_order()',
    'public.touch_wishlist_collection()',
    'public.update_tailor_rating_stats()'
  ];
  authenticated_signatures constant text[] := array[
    'public.mark_my_communication_inbox(uuid,text)',
    'public.set_my_communication_preference(text,text,boolean,text)',
    'public.set_my_marketing_consent(text,boolean,text,text,jsonb)'
  ];
  intended_public_signatures constant text[] := array[
    -- Required by anonymous marketplace RLS policies.
    'public.is_public_tailor_profile(text)',
    -- Required as pgrst.db_pre_request after authenticator switches to the API role.
    'public.reject_staff_draft_data_api_request()'
  ];
begin
  foreach signature in array service_or_trigger_signatures loop
    routine := to_regprocedure(signature);
    if routine is null then
      raise notice 'Skipping absent forward-only routine %', signature;
      continue;
    end if;
    execute format('revoke execute on function %s from public, anon, authenticated', routine);
    execute format('grant execute on function %s to service_role', routine);
  end loop;

  foreach signature in array authenticated_signatures loop
    routine := to_regprocedure(signature);
    if routine is null then
      raise notice 'Skipping absent forward-only routine %', signature;
      continue;
    end if;
    execute format('revoke execute on function %s from public, anon', routine);
    execute format('grant execute on function %s to authenticated, service_role', routine);
  end loop;

  foreach signature in array intended_public_signatures loop
    routine := to_regprocedure(signature);
    if routine is null then
      raise notice 'Skipping absent forward-only routine %', signature;
      continue;
    end if;
    execute format('revoke execute on function %s from public', routine);
    execute format('grant execute on function %s to anon, authenticated, service_role', routine);
  end loop;

  routine := to_regprocedure('public.reject_staff_draft_data_api_request()');
  if routine is not null then
    execute format('grant execute on function %s to authenticator', routine);
  end if;
end;
$migration$;

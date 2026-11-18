-- Restore the established per-column permission baseline after the earlier
-- Dev-only repair was applied before its table-grant guard was corrected.
-- It runs only when the narrow, broken state is present, so Production's
-- established baseline is a true no-op. It restores Dev without ever granting
-- table-wide SELECT.
--
-- Source of truth: Production information_schema.column_privileges captured
-- 2026-11-17 for anon and authenticated on public.tailor_profiles.

do $$
begin
  if not has_column_privilege('anon', 'public.tailor_profiles', 'bio', 'select') then
    grant select (
  accepts_custom_orders_now, availability, avatar_url, avg_rating,
  avg_response_hours, bio, business_name, created_at, currency,
  delivery_available, delivery_fee, display_name, id,
  id_verification_status, is_live, is_verified, languages, location,
  marketplace_category, pickup_available, portfolio_photo_urls,
  portfolio_video_urls, price_range_max, price_range_min,
  profile_completed, ranking_score, seller_type, shipping_available,
  shipping_fee, ships_internationally, shop_paused, specialty_tags,
  supports_custom_orders, supports_ready_made, tier, total_orders,
  total_reviews, updated_at
) on table public.tailor_profiles to anon;
  end if;

  if not has_column_privilege('authenticated', 'public.tailor_profiles', 'user_id', 'select') then
    grant select (
  accepts_custom_orders_now, availability, avatar_url, avg_rating,
  avg_response_hours, bio, business_name, bypass_attempts,
  consultation_call_type, consultation_currency,
  consultation_duration_minutes, consultation_fee_amount,
  consultation_fee_creditable, consultation_mode,
  consultation_policy_published_at, consultation_policy_version,
  consultation_requirement, created_at, currency, delivery_available,
  delivery_fee, display_name, id, id_selfie_document_url,
  id_verification_handoff_id, id_verification_metadata,
  id_verification_method, id_verification_rejected_at,
  id_verification_rejection_reason, id_verification_status,
  id_verification_submitted_at, id_verified_at, is_live,
  is_test_profile, is_verified, languages, location, marketplace_category,
  payout_account_change_count, payout_account_change_locked_until,
  payout_account_last_changed_at, payout_account_type,
  payout_account_verified, payout_account_verified_at, payout_currency,
  payout_destination_hold_until, payout_provider,
  payout_reverification_required, paystack_recipient_code,
  pickup_available, portfolio_photo_urls, portfolio_video_urls,
  price_range_max, price_range_min, profile_completed, ranking_score,
  seller_type, shipping_available, shipping_fee, ships_internationally,
  shop_paused, specialty_tags, stripe_connect_account_id,
  supports_custom_orders, supports_ready_made, tier, tier_lost_at,
  total_orders, total_reviews, updated_at, user_id
) on table public.tailor_profiles to authenticated;
  end if;
end
$$;

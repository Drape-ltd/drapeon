-- Release stage A: keep owner-only trust and payout state behind an
-- auth.uid()-scoped RPC instead of granting those columns to every signed-in
-- customer. This migration is deliberately additive: the column revokes are
-- staged separately, after web and then native clients can use this RPC.

create or replace function public.get_my_tailor_account_profile()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', tp.id,
    'display_name', tp.display_name,
    'business_name', tp.business_name,
    'bio', tp.bio,
    'location', tp.location,
    'languages', tp.languages,
    'specialty_tags', tp.specialty_tags,
    'currency', tp.currency,
    'tier', tp.tier,
    'availability', tp.availability,
    'accepts_custom_orders_now', tp.accepts_custom_orders_now,
    'shop_paused', tp.shop_paused,
    'seller_type', tp.seller_type,
    'marketplace_category', tp.marketplace_category,
    'is_live', tp.is_live,
    'is_verified', tp.is_verified,
    'avg_rating', tp.avg_rating,
    'total_reviews', tp.total_reviews,
    'total_orders', tp.total_orders,
    'supports_custom_orders', tp.supports_custom_orders,
    'supports_ready_made', tp.supports_ready_made,
    'pickup_available', tp.pickup_available,
    'delivery_available', tp.delivery_available,
    'shipping_available', tp.shipping_available,
    'delivery_fee', tp.delivery_fee,
    'shipping_fee', tp.shipping_fee,
    'ships_internationally', tp.ships_internationally,
    'price_range_min', tp.price_range_min,
    'price_range_max', tp.price_range_max,
    'portfolio_photo_urls', tp.portfolio_photo_urls,
    'portfolio_video_urls', tp.portfolio_video_urls,
    'avatar_url', tp.avatar_url
  ) || jsonb_build_object(
    'profile_completed', tp.profile_completed,
    'id_verification_status', tp.id_verification_status,
    'id_verification_submitted_at', tp.id_verification_submitted_at,
    'id_verification_rejection_reason', tp.id_verification_rejection_reason,
    'id_verification_rejected_at', tp.id_verification_rejected_at,
    'id_verification_metadata', tp.id_verification_metadata,
    'consultation_mode', tp.consultation_mode,
    'consultation_requirement', tp.consultation_requirement,
    'consultation_fee_amount', tp.consultation_fee_amount,
    'consultation_currency', tp.consultation_currency,
    'consultation_duration_minutes', tp.consultation_duration_minutes,
    'consultation_call_type', tp.consultation_call_type,
    'consultation_fee_creditable', tp.consultation_fee_creditable,
    'payout_currency', tp.payout_currency,
    'payout_provider', tp.payout_provider,
    'payout_reverification_required', tp.payout_reverification_required,
    'payout_account_type', tp.payout_account_type,
    'payout_account_verified', tp.payout_account_verified,
    'payout_account_verified_at', tp.payout_account_verified_at,
    'payout_account_change_count', tp.payout_account_change_count,
    'payout_account_last_changed_at', tp.payout_account_last_changed_at,
    'payout_account_change_locked_until', tp.payout_account_change_locked_until,
    'payout_destination_hold_until', tp.payout_destination_hold_until
  )
  from public.tailor_profiles as tp
  where tp.user_id::text = (select auth.uid())::text
  limit 1;
$$;

revoke all on function public.get_my_tailor_account_profile() from public;
revoke all on function public.get_my_tailor_account_profile() from anon;
grant execute on function public.get_my_tailor_account_profile() to authenticated;

import { availableFulfillmentMethods, isReadyFulfillmentOrigin } from '../../../packages/shared/src/fulfillment-eligibility.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

/** Public readiness only. Never return the private origin/address snapshot. */
export async function publicFulfillmentOptions(supabase: SupabaseClient, tailorId: string) {
  const { data: profile, error } = await supabase.from('tailor_profiles')
    .select('user_id,pickup_available,delivery_available,shipping_available')
    .eq('id', tailorId).eq('is_live', true).eq('is_verified', true)
    .eq('is_test_profile', false).maybeSingle()
  if (error) throw error
  if (!profile) return { originReady: false, methods: [] }
  const { data: origin, error: originError } = await supabase.from('tailor_pickup_details')
    .select('pickup_address_line1,pickup_city,pickup_country_code,pickup_location_verification_source,pickup_location_verified_at')
    .eq('user_id', profile.user_id).maybeSingle()
  if (originError) throw originError
  const originReady = isReadyFulfillmentOrigin(origin ? {
    addressLine1: origin.pickup_address_line1 ?? '', city: origin.pickup_city,
    countryCode: origin.pickup_country_code ?? '', regionCode: null, postalCode: null,
    verificationSource: origin.pickup_location_verification_source ?? '',
    verificationReference: null, verifiedAt: origin.pickup_location_verified_at ?? '',
  } : null)
  return { originReady, methods: availableFulfillmentMethods(profile, originReady) }
}

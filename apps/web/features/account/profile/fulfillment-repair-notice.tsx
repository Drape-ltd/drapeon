import Link from 'next/link'
import { isReadyFulfillmentOrigin } from '@drape/shared'
import type { ProfileRenderData } from '../shared/account-data-contracts'

export function profileFulfillmentOriginReady(pickup: ProfileRenderData['pickupDetails']) {
  return isReadyFulfillmentOrigin(pickup ? {
    addressLine1: pickup.pickup_address_line1 ?? '', city: pickup.pickup_city,
    countryCode: pickup.pickup_country_code ?? '', regionCode: pickup.pickup_region,
    postalCode: pickup.pickup_postal_code,
    verificationSource: pickup.pickup_location_verification_source ?? '',
    verificationReference: pickup.pickup_location_verification_reference ?? null,
    verifiedAt: pickup.pickup_location_verified_at ?? '',
  } : null)
}

export function FulfillmentRepairNotice({ data }: { data: ProfileRenderData }) {
  const profile = data.tailorProfile
  if (!profile || !(profile.pickup_available || profile.delivery_available || profile.shipping_available) || profileFulfillmentOriginReady(data.pickupDetails)) return null
  return <section role="status" className="rounded-[8px] border border-kante/30 bg-white p-4 text-sm text-ink">
    <h2 className="font-semibold">Finish fulfillment setup so customers can place new orders</h2>
    <p className="mt-2">Confirm your dispatch address, city and country. Your saved methods and existing orders stay unchanged.</p>
    <Link className="mt-3 inline-block font-semibold text-needle underline" href="/account/profile?fulfillment=1#fulfillment">Finish fulfillment setup</Link>
  </section>
}

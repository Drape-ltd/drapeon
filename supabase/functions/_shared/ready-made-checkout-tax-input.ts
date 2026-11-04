export type ReadyMadeCheckoutTaxLocation = {
  address: string | null
  city: string | null
  region: string | null
  postalCode: string | null
  countryCode: string | null
}

export function readyMadeCheckoutTaxLocation(input: {
  fulfillment: 'PICKUP' | 'DELIVERY' | 'SHIPPING'
  delivery: ReadyMadeCheckoutTaxLocation
  pickup: ReadyMadeCheckoutTaxLocation
}): ReadyMadeCheckoutTaxLocation {
  return input.fulfillment === 'PICKUP' ? input.pickup : input.delivery
}

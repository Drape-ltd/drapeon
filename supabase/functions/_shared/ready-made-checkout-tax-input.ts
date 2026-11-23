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

export async function resolveReadyMadeActivatedTaxDecision<TArgs extends object, TResult>(input: {
  taxLocation: ReadyMadeCheckoutTaxLocation
  decisionInput: TArgs
  resolveDecision: (
    decisionInput: TArgs & { jurisdictionRegionCode: string | null },
  ) => Promise<TResult>
}): Promise<TResult> {
  return await input.resolveDecision({
    ...input.decisionInput,
    jurisdictionRegionCode: input.taxLocation.region,
  })
}

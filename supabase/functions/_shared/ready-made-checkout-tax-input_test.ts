import { assertEquals } from 'jsr:@std/assert'
import { readyMadeCheckoutTaxLocation } from './ready-made-checkout-tax-input.ts'

Deno.test('pickup pricing uses the seller structured pickup tax location', () => {
  const actual = readyMadeCheckoutTaxLocation({
    fulfillment: 'PICKUP',
    delivery: {
      address: null,
      city: null,
      region: null,
      postalCode: null,
      countryCode: null,
    },
    pickup: {
      address: '100 Congress Ave',
      city: 'Austin',
      region: 'TX',
      postalCode: '78701',
      countryCode: 'US',
    },
  })

  assertEquals(actual, {
    address: '100 Congress Ave',
    city: 'Austin',
    region: 'TX',
    postalCode: '78701',
    countryCode: 'US',
  })
})

Deno.test('delivery and shipping pricing keep the customer tax location', () => {
  const delivery = {
    address: '200 Congress Ave',
    city: 'Austin',
    region: 'TX',
    postalCode: '78701',
    countryCode: 'US',
  }
  const pickup = {
    address: '100 Congress Ave',
    city: 'Austin',
    region: 'TX',
    postalCode: '78701',
    countryCode: 'US',
  }

  assertEquals(readyMadeCheckoutTaxLocation({ fulfillment: 'DELIVERY', delivery, pickup }), delivery)
  assertEquals(readyMadeCheckoutTaxLocation({ fulfillment: 'SHIPPING', delivery, pickup }), delivery)
})

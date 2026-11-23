import Constants from 'expo-constants'
import { stripeReturnConfigForScheme } from './stripe-return-url'

/** The current binary's registered scheme is authoritative for Stripe callbacks. */
export function getStripeReturnConfig() {
  return stripeReturnConfigForScheme(Constants.expoConfig?.scheme)
}

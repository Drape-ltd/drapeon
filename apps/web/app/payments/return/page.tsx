// Keep the customer-facing return URL provider-neutral. The implementation
// also remains mounted at /payments/paystack/callback for sessions that were
// already in flight when this route was introduced.
export { default } from '../paystack/callback/page'

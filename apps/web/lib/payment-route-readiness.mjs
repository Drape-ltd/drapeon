export function countMatchingActiveDestinations(route, destinations) {
  return destinations.filter((destination) =>
    destination.provider === route.provider
    && destination.legal_entity === route.legal_entity
    && destination.country_code === route.tailor_country_code
    && destination.currency === route.payout_currency
    && destination.fees_collector === route.fees_collector
    && destination.active === true
    && destination.transfers_enabled === true
    && destination.payouts_enabled === true
    && destination.first_withdrawal_review_status === 'CLEARED'
  ).length
}

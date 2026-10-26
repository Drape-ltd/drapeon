export function summarizeMatchingDestinations(route, destinations) {
  const matching = destinations.filter(
    (destination) =>
      destination.provider === route.provider &&
      destination.legal_entity === route.legal_entity &&
      destination.country_code === route.tailor_country_code &&
      destination.currency === route.payout_currency &&
      destination.fees_collector === route.fees_collector
  )

  return {
    matchingCount: matching.length,
    readyCount: matching.filter(
      (destination) =>
        destination.active === true &&
        destination.transfers_enabled === true &&
        destination.payouts_enabled === true &&
        destination.first_withdrawal_review_status === 'CLEARED' &&
        destination.capability_checked_at != null
    ).length,
    reviewPendingCount: matching.filter(
      (destination) => destination.first_withdrawal_review_status === 'PENDING'
    ).length,
    reviewBlockedCount: matching.filter(
      (destination) => destination.first_withdrawal_review_status === 'BLOCKED'
    ).length,
    inactiveCount: matching.filter((destination) => destination.active !== true).length,
    transfersUnavailableCount: matching.filter(
      (destination) => destination.transfers_enabled !== true
    ).length,
    payoutsUnavailableCount: matching.filter((destination) => destination.payouts_enabled !== true)
      .length,
    capabilityCheckMissingCount: matching.filter(
      (destination) => destination.capability_checked_at == null
    ).length,
  }
}

export function countMatchingActiveDestinations(route, destinations) {
  return summarizeMatchingDestinations(route, destinations).readyCount
}

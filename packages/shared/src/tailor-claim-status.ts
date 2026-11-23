export const TAILOR_CLAIM_STATUS_PRESENTATION: Record<string, { label: string; tone: string }> = {
  DRAFT: { label: 'Draft', tone: 'warning' },
  INVITED: { label: 'Link sent', tone: 'healthy' },
  OPENED: { label: 'Opened by tailor', tone: 'healthy' },
  CLAIMING: { label: 'Claim in progress', tone: 'warning' },
  CLAIMED_AWAITING_EMAIL: { label: 'Waiting for email verification', tone: 'warning' },
  FINALIZING: { label: 'Finalizing storefront', tone: 'warning' },
  CLAIMED: { label: 'Claimed', tone: 'healthy' },
  LIVE: { label: 'Live', tone: 'healthy' },
  SUSPENDED: { label: 'Suspended', tone: 'critical' },
  REVOKED: { label: 'Link revoked', tone: 'critical' },
  DECLINED: { label: 'Declined', tone: 'critical' },
  EXPIRED: { label: 'Expired', tone: 'warning' },
}

export function tailorClaimStatusPresentation(value: string) {
  return (
    TAILOR_CLAIM_STATUS_PRESENTATION[value] ?? {
      label: value
        .toLowerCase()
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' '),
      tone: 'warning',
    }
  )
}

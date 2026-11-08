const DEFAULT_APPROVER = 'founders@drapeon.co'

export function isConfiguredMoneyDeskApprover(email: string | null | undefined, configured: string | undefined): boolean {
  const normalized = email?.trim().toLowerCase()
  if (!normalized) return false
  return (configured ?? DEFAULT_APPROVER)
    .split(',')
    .some((entry) => entry.trim().toLowerCase() === normalized)
}

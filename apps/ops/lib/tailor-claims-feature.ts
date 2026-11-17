export function isTailorClaimsEnabled(): boolean {
  return process.env.DRAPE_TAILOR_CLAIMS_ENABLED === '1'
}

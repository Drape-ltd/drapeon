export type ShopItemExitDecision = 'dispatch' | 'block' | 'prompt'

/**
 * Route removal can arrive before React has rendered a cleared dirty flag.
 * An intentional exit wins synchronously so the original navigation action
 * continues without showing the stale unsaved-changes prompt.
 */
export function getShopItemExitDecision({
  allowExit,
  saving,
}: {
  allowExit: boolean
  saving: boolean
}): ShopItemExitDecision {
  if (allowExit) return 'dispatch'
  if (saving) return 'block'
  return 'prompt'
}

export function continueAfterDraftDelete(
  error: unknown,
  allowExit: () => void,
  navigateToDrafts: () => void,
) {
  if (error !== null && error !== undefined) return false

  allowExit()
  navigateToDrafts()
  return true
}

export function continueAfterDraftDelete(
  error: unknown,
  clearUnsavedChanges: () => void,
  navigateToDrafts: () => void,
) {
  if (error !== null && error !== undefined) return false

  clearUnsavedChanges()
  navigateToDrafts()
  return true
}

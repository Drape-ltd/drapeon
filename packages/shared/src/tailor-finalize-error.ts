/** Copy shared by the app and web handoff. Never display a server error code. */
const FINALIZE_FAILURE_COPY: Record<string, string> = {
  FINALIZE_READINESS_CHANGED:
    'Your shop details changed while publishing. Review the setup and try publishing again.',
  PROMOTED_MANIFEST_STALE:
    'Your shop photos changed while publishing. Review the photos and try publishing again.',
  FINALIZE_MEDIA_CHANGED:
    'An approved photo changed while publishing. Review the shop media and try again.',
  PROMOTED_ASSET_INVALID:
    'A shop photo could not be published safely. Your shop is still private; try publishing again.',
  PROMOTED_MEDIA_INCOMPLETE:
    'A required shop photo is missing. Review the shop media and try publishing again.',
  SOURCE_MANIFEST_INVALID:
    'A shop file could not be verified. Review the shop media and try again. Contact support if this continues.',
  FINALIZE_CLEANUP_RETRY:
    'We are safely resetting the shop media. Wait a moment, then try publishing again.',
  FINALIZE_RETRY_REQUIRED:
    'The shop media has been reset safely. Try publishing again.',
}

export function tailorFinalizeFailureCopy(code: unknown): string | null {
  return typeof code === 'string' ? FINALIZE_FAILURE_COPY[code] ?? null : null
}

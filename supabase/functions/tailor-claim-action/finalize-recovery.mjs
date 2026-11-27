const terminalErrors = new Map([
  ['P1101', 'FINALIZE_READINESS_CHANGED'],
  ['P1102', 'PROMOTED_MANIFEST_STALE'],
  ['P1103', 'FINALIZE_MEDIA_CHANGED'],
  ['P1104', 'PROMOTED_ASSET_INVALID'],
  ['P1106', 'PROMOTED_MEDIA_INCOMPLETE'],
])

export function terminalFinalizeFailure(error) {
  return terminalErrors.get(error?.code) ?? null
}

export function publicClaimMediaObject(profileId, source) {
  const id = typeof source?.id === 'string' ? source.id : ''
  const sourcePath = typeof source?.storagePath === 'string' ? source.storagePath : ''
  const kind = source?.kind
  const contentType = typeof source?.contentType === 'string' ? source.contentType : ''
  if (!id || !sourcePath || !['AVATAR', 'PHOTO', 'VIDEO'].includes(kind)) return null
  const extension =
    contentType === 'image/png'
      ? 'png'
      : contentType === 'image/webp'
        ? 'webp'
        : contentType.startsWith('video/')
          ? 'mp4'
          : 'jpg'
  return {
    draftMediaId: id,
    sourcePath,
    kind,
    contentType,
    bucket: kind === 'AVATAR' ? 'avatars' : 'portfolio-photos',
    objectPath: `claims/${profileId}/${id}.${extension}`,
  }
}

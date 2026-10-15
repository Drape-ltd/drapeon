/** A public Storage image can be resized without changing the full-size source URL. */
export function publicStorageThumbnailUrl(
  original: string,
  bucket: string,
  projectOrigin: string,
  canonicalOrigin: string | null,
  width: number,
): string {
  try {
    const url = new URL(original)
    const prefix = `/storage/v1/object/public/${bucket}/`
    if (
      (url.origin !== projectOrigin && url.origin !== canonicalOrigin) ||
      !url.pathname.startsWith(prefix) || url.search || url.hash
    ) return original
    url.pathname = url.pathname.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/')
    url.searchParams.set('width', String(Math.max(1, Math.round(width))))
    url.searchParams.set('quality', '72')
    return url.toString()
  } catch {
    return original
  }
}

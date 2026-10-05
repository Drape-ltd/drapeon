import { Platform, Share } from 'react-native'
import { File, Paths } from 'expo-file-system'
import { StorageAccessFramework, writeAsStringAsync, EncodingType } from 'expo-file-system/legacy'
export async function exportStudioFile(raw: Record<string, unknown>) {
  const allowed: Record<string, string> = {
    json: 'application/json',
    svg: 'image/svg+xml',
    txt: 'text/plain;charset=utf-8',
    png: 'image/png',
  }
  const extension = String(raw.extension),
    mime = allowed[extension]
  if (
    !mime ||
    raw.mime !== mime ||
    typeof raw.contents !== 'string' ||
    raw.contents.length > 24_000_000
  )
    throw Error('This export is not supported.')
  const base64 = raw.base64 === true
  if (
    base64 !== (extension === 'png') ||
    (base64 && !/^iVBORw0KGgo[A-Za-z0-9+/=]+$/.test(raw.contents))
  )
    throw Error('This image could not be exported.')
  const name = `drapeon-design-${Date.now()}.${extension}`
  if (Platform.OS === 'android') {
    const access = await StorageAccessFramework.requestDirectoryPermissionsAsync()
    if (!access.granted) throw Error('Export cancelled. Your design is still here.')
    const uri = await StorageAccessFramework.createFileAsync(
      access.directoryUri,
      name,
      mime.split(';')[0]!
    )
    await writeAsStringAsync(uri, raw.contents, {
      encoding: base64 ? EncodingType.Base64 : EncodingType.UTF8,
    })
  } else {
    const file = new File(Paths.cache, name)
    file.write(raw.contents, base64 ? { encoding: 'base64' } : undefined)
    await Share.share({ url: file.uri, title: 'Drapeon design' })
  }
}

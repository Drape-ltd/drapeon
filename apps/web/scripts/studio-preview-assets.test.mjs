import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const previewPath = path.join(root, 'apps/web/features/account/studio-workspace/studio-guest-preview.tsx')

test('every Sketch Room guest preview image is served from public', async () => {
  const source = await readFile(previewPath, 'utf8')
  const imagePaths = [...source.matchAll(/image: '(\/studio-preview\/[^']+)'/g)].map((match) => match[1])
  assert.ok(imagePaths.length > 0, 'Guest preview must declare sample images')

  for (const imagePath of imagePaths) {
    const asset = path.join(root, 'apps/web/public', imagePath.slice(1))
    assert.ok((await stat(asset)).size > 0, `${imagePath} must exist and be nonempty`)
  }
})

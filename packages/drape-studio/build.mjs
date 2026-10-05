import { build } from 'esbuild'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const root = new URL('./', import.meta.url)
const result = await build({
  entryPoints: [new URL('src/studio-entry.ts', root).pathname],
  bundle: true,
  write: false,
  format: 'iife',
  target: ['safari16', 'chrome110'],
  loader: { '.png': 'dataurl', '.jpg': 'dataurl' },
  minify: true,
})
const script = result.outputFiles[0].text.replaceAll('</script', '<\\/script')
let html = await readFile(new URL('studio-sketch.html', root), 'utf8')
const readCss = await readFile(new URL('studio-sketch.css', root), 'utf8')
html = html.replace(
  '<link rel="stylesheet" href="studio.css">',
  () => '<style>' + readCss + '</style>'
)
html = html.replace('__STUDIO__', () => script)
const document = JSON.stringify({
  html,
  scriptHash: createHash('sha256').update(script).digest('base64'),
})
await mkdir(new URL('dist/', root), { recursive: true })
await writeFile(new URL('dist/studio-document.json', root), document)
const mobile = new URL('../../apps/mobile/assets/studio/', root)
await mkdir(mobile, { recursive: true })
await writeFile(new URL('studio-document.json', mobile), document)
const web = new URL('../../apps/web/features/account/studio-workspace/', root)
await mkdir(web, { recursive: true })
await writeFile(new URL('studio-document.json', web), document)
console.log('Built shared Studio document for web and mobile')

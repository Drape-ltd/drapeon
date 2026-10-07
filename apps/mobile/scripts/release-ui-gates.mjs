import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// Existing diagnostics and explicitly dev-only tooling are reviewed here.
// A new occurrence, even in an existing file, fails until deliberately reviewed.
const approvedDevLines = JSON.parse(await readFile(new URL('./release-ui-dev-baseline.json', import.meta.url), 'utf8'))

export function releaseUiGateErrors(sources, baseline = approvedDevLines) {
  const errors = []
  for (const [path, source] of Object.entries(sources)) {
    const seen = {}
    const lines = source.split(/\r?\n/u)
    for (const [index, rawLine] of lines.entries()) {
      const line = rawLine.trim()
      if (/\b__DEV__\b/u.test(line)) {
        seen[line] = (seen[line] ?? 0) + 1
        if (seen[line] > (baseline[path]?.[line] ?? 0)) {
          errors.push(`${path}:${index + 1}: new development-only gate; release requires an explicit reviewed feature decision`)
        }
      }
      if (/EXPO_PUBLIC_(?:SUPABASE_ENV|APP_VARIANT)\s*===?\s*['"]development['"]/u.test(line)) {
        errors.push(`${path}:${index + 1}: environment-specific product UI gate`)
      }
    }
  }

  const required = [
    ['features/explore/ExploreCategoryChips.tsx', "{ id: 'studio', label: 'Sketch Room'"],
    ['features/studio/StudioEntry.tsx', 'Open Sketch Room'],
    ['features/studio/StudioScreen.tsx', 'Sign in to use Sketch Room'],
    ['features/user-education/EducationTools.tsx', 'Open Sketch Room'],
  ]
  for (const [path, marker] of required) {
    if (!sources[path]?.includes(marker)) errors.push(`${path}: required release surface is missing: ${marker}`)
  }
  return errors
}

async function readUiSources(root) {
  const sources = {}
  async function walk(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name)
      if (item.isDirectory()) await walk(path)
      else if (/\.tsx?$/u.test(item.name)) sources[relative(root, path).replaceAll('\\', '/')] = await readFile(path, 'utf8')
    }
  }
  await Promise.all(['app', 'features', 'components', 'lib'].map((directory) => walk(join(root, directory))))
  return sources
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const errors = releaseUiGateErrors(await readUiSources(root))
  for (const error of errors) console.error(`[release UI] ${error}`)
  if (errors.length) process.exitCode = 1
  else console.log('Mobile release UI surfaces are present; no unreviewed development-only UI gates.')
}

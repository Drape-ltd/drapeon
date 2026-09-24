import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const repositoryRoot = process.cwd()
const configPath = path.join(repositoryRoot, 'config/source-size-baseline.json')
const config = JSON.parse(await readFile(configPath, 'utf8'))
const sourceExtension = /\.(?:[cm]?[jt]sx?)$/

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await collectFiles(absolutePath)))
    else if (entry.isFile() && sourceExtension.test(entry.name)) files.push(absolutePath)
  }

  return files
}

function countLines(source) {
  if (source.length === 0) return 0
  return source.split(/\r?\n/).length - (source.endsWith('\n') ? 1 : 0)
}

const files = (
  await Promise.all(config.roots.map((root) => collectFiles(path.join(repositoryRoot, root))))
).flat()
const failures = []
const warnings = []

for (const absolutePath of files) {
  const relativePath = path.relative(repositoryRoot, absolutePath).split(path.sep).join('/')
  const lineCount = countLines(await readFile(absolutePath, 'utf8'))
  const legacyCap = config.legacyCaps[relativePath]
  const cap = legacyCap ?? config.maxNewFileLines

  if (lineCount > cap) {
    failures.push(`${relativePath}: ${lineCount} lines (cap ${cap})`)
  } else if (lineCount >= config.warningLines && legacyCap === undefined) {
    warnings.push(`${relativePath}: ${lineCount} lines`)
  }
}

if (warnings.length > 0) {
  console.warn(`Source-size warnings (extract before ${config.maxNewFileLines} lines):`)
  for (const warning of warnings) console.warn(`  - ${warning}`)
}

if (failures.length > 0) {
  console.error('Source-size ratchet failed:')
  for (const failure of failures) console.error(`  - ${failure}`)
  console.error('Extract a domain module; do not raise a legacy cap to make this check pass.')
  process.exitCode = 1
} else {
  console.log(`Source-size ratchet passed for ${files.length} files.`)
}

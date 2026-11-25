#!/usr/bin/env node
// Static literal-call inventory. The catalog JSON is supplied from a read-only
// Production pg_class/pg_proc/storage.buckets query, never from a secret key.
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
function option(name, fallback = null) {
  const at = args.indexOf(name)
  return at < 0 ? fallback : args[at + 1]
}
const root = path.resolve(option('--root', '.'))
const catalogFile = option('--catalog')
if (!catalogFile) throw new Error('Pass --catalog <read-only Production catalog JSON>')
const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'))
const known = {
  table: new Set(catalog.tables ?? []),
  rpc: new Set(catalog.rpcs ?? []),
  bucket: new Set(catalog.buckets ?? []),
}
const uses = new Map()
const extension = /\.(?:[cm]?js|[cm]?ts|jsx|tsx)$/u
function walk(dir) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '.expo', 'dist', 'build', 'coverage'].includes(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { walk(full); continue }
    if (!extension.test(entry.name)) continue
    const rel = path.relative(root, full).replaceAll(path.sep, '/')
    const source = fs.readFileSync(full, 'utf8')
    const call = /\.\s*(from|rpc)\s*\(\s*(['"])([a-z][a-z0-9_-]*)\2/gu
    for (const match of source.matchAll(call)) {
      const preceding = source.slice(Math.max(0, match.index - 90), match.index)
      const kind = match[1] === 'rpc' ? 'rpc' : /\.\s*storage\s*$/u.test(preceding) ? 'bucket' : 'table'
      const key = `${kind}:${match[3]}`
      const line = source.slice(0, match.index).split('\n').length
      const record = uses.get(key) ?? { kind, name: match[3], sites: [] }
      record.sites.push({ file: rel, line })
      uses.set(key, record)
    }
  }
}
walk(path.join(root, 'apps'))
walk(path.join(root, 'supabase', 'functions'))
const records = [...uses.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
for (const record of records) {
  record.present = known[record.kind].has(record.name)
  const runtime = record.sites.filter(s => !/(?:_test|\.test|\.spec|\/tests?\/|\/scripts\/)/u.test(s.file))
  record.rank = runtime.some(s => s.file.startsWith('supabase/functions/') && !s.file.includes('/reconcile-dev-'))
    ? 'HIGH'
    : runtime.length ? 'MEDIUM' : 'LOW'
}
const missing = records.filter(r => !r.present).sort((a, b) => ({ HIGH: 0, MEDIUM: 1, LOW: 2 })[a.rank] - ({ HIGH: 0, MEDIUM: 1, LOW: 2 })[b.rank] || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
process.stdout.write(JSON.stringify({ root, totals: { all: records.length, missing: missing.length }, records, missing }, null, 2) + '\n')

#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const migrationDir = resolve(dirname(fileURLToPath(import.meta.url)), '../supabase/migrations')
const files = readdirSync(migrationDir).filter((name) => name.endsWith('.sql')).sort()
const boundaryFile = '20261117225500_add_tailor_claim_bootstrap_sessions.sql'
const boundaryIndex = files.indexOf(boundaryFile)
if (boundaryIndex < 0) throw new Error(`Missing STAFF_DRAFT RLS boundary migration ${boundaryFile}`)

const boundary = readFileSync(resolve(migrationDir, boundaryFile), 'utf8')
if (!/c\.relrowsecurity[\s\S]*n\.nspname = 'public'[\s\S]*create policy deny_staff_draft_claim_session/i.test(boundary)) {
  throw new Error('The bootstrap migration must stamp deny_staff_draft_claim_session on every existing public RLS table.')
}

const laterSql = files.slice(boundaryIndex + 1).map((name) => readFileSync(resolve(migrationDir, name), 'utf8')).join('\n')
const paymentRepair = '20261123165353_add_staff_draft_deny_policies_for_payment_tables.sql'
const paymentRepairSql = files.includes(paymentRepair)
  ? readFileSync(resolve(migrationDir, paymentRepair), 'utf8')
  : ''
const hasDynamicPaymentRepair = /create policy deny_staff_draft_claim_session on public\.%I as restrictive for all to authenticated using \(not public\.is_staff_draft_identity\(\)\) with check \(not public\.is_staff_draft_identity\(\)\)/i.test(paymentRepairSql)
const enabled = new Set()
const enablePattern = /alter\s+table\s+(?:if\s+exists\s+)?public\."?([a-zA-Z0-9_]+)"?\s+enable\s+row\s+level\s+security/gi
for (const match of laterSql.matchAll(enablePattern)) enabled.add(match[1])

const missing = [...enabled].filter((table) => {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const policyPattern = new RegExp(
    `create\\s+policy\\s+deny_staff_draft_claim_session\\s+on\\s+public\\."?${escaped}"?`,
    'i',
  )
  const dynamicallyRepaired = hasDynamicPaymentRepair
    && paymentRepairSql.includes(`'${table}'`)
  return !policyPattern.test(laterSql) && !dynamicallyRepaired
})

if (missing.length) {
  throw new Error(`Public RLS tables missing deny_staff_draft_claim_session: ${missing.sort().join(', ')}`)
}

console.log(`GREEN: STAFF_DRAFT deny-policy contract covers historical tables and ${enabled.size} later public RLS table(s).`)

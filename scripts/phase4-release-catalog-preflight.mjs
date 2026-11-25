#!/usr/bin/env node
// Promotion gate: compare merged source with a freshly collected names-only catalog.
import { readFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const catalogAt = args.indexOf('--catalog')
if (catalogAt < 0 || !args[catalogAt + 1]) {
  throw new Error('Pass --catalog <fresh names-only Production catalog JSON>')
}
const catalogFile = resolve(args[catalogAt + 1])
const ageMinutes = (Date.now() - statSync(catalogFile).mtimeMs) / 60_000
if (ageMinutes < 0 || ageMinutes > 15) {
  throw new Error(`Production catalog is ${Math.round(ageMinutes)} minutes old; collect it again (maximum 15 minutes)`)
}
const catalog = JSON.parse(readFileSync(catalogFile, 'utf8'))
if (Object.keys(catalog).sort().join(',') !== 'buckets,rpcs,tables') {
  throw new Error('Catalog must contain only names-only arrays: tables, rpcs, buckets')
}
for (const kind of ['tables', 'rpcs', 'buckets']) {
  if (!Array.isArray(catalog[kind]) || !catalog[kind].every((name) => /^[a-z][a-z0-9_-]*$/u.test(name))) {
    throw new Error(`Catalog ${kind} must be an array of object names`)
  }
  if (new Set(catalog[kind]).size !== catalog[kind].length) {
    throw new Error(`Catalog ${kind} contains duplicate names`)
  }
}
if (catalog.tables.length < 100 || catalog.rpcs.length < 100 || catalog.buckets.length < 1) {
  throw new Error('Catalog is incomplete; collect all public/payment_internal names and storage bucket IDs')
}

const result = spawnSync(process.execPath, ['scripts/phase4-catalog-guard.mjs', '--root', '.', '--catalog', catalogFile], {
  encoding: 'utf8',
})
if (result.status !== 0) throw new Error(result.stderr || 'Catalog inventory failed')
const inventory = JSON.parse(result.stdout)

// Known gaps from the 2026-11-24 reviewed audit. This list is a temporary
// exception register, not permission to promote any missing object.
const knownMissing = new Set([
  'rpc:apply_reviewed_claimed_payout_retry',
  'rpc:bind_payout_provider_operation_source_transaction',
  'rpc:close_unstarted_reviewed_claimed_retry',
  'rpc:close_unstarted_settlement_tranche_payout',
  'rpc:complete_reviewed_failed_refund_journal_recovery',
  'rpc:list_due_settlement_eligibility_plans',
  'rpc:list_due_settlement_eligibility_tranches',
  'rpc:load_reviewed_claimed_tranche_retry',
  'rpc:queue_reviewed_dispatch_refund_retry',
  'rpc:queue_reviewed_fabric_release_recovery',
  'rpc:reconcile_definite_payout_rejection',
  'table:dispatch_refund_retry_operations',
  'table:payout_claim_retry_authorizations',
  'rpc:bind_dev_ops_mfa_principal',
  'rpc:complete_dev_reviewed_tip_refund_reconciliation',
  'rpc:decide_local_supabase_mfa_money_desk_request',
  'rpc:is_dev_ops_mfa_environment',
  'rpc:issue_local_supabase_mfa_money_desk_grant',
  'rpc:list_customer_order_refund_receipts',
])
const unexpected = inventory.missing.filter(({ kind, name }) => !knownMissing.has(`${kind}:${name}`))
if (unexpected.length) {
  console.error('Unclassified source/catalog drift:', unexpected.map(({ kind, name }) => `${kind}:${name}`).join(', '))
  process.exit(1)
}
console.log(`Catalog preflight passed: ${inventory.totals.all} names checked; ${inventory.missing.length} reviewed gaps remain.`)

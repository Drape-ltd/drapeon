import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const sql = readFileSync(
  new URL('../supabase/migrations/20261124171500_pin_remaining_function_search_paths.sql', import.meta.url),
  'utf8',
)

const expected = [
  'assert_commercial_ledger_transaction_balanced',
  'copy_receipt_tax_decision_snapshot',
  'derive_seller_item_stock_status',
  'enforce_custom_order_detail_rules',
  'enforce_custom_order_stage_rules',
  'is_terminal_order_stage',
  'normalize_account_phone_e164',
  'prevent_commercial_benefit_history_mutation',
  'prevent_commercial_ledger_mutation',
  'prevent_fabric_event_mutation',
  'prevent_financial_case_append_only_mutation',
  'prevent_fulfillment_selection_event_mutation',
  'prevent_money_desk_append_only_mutation',
  'prevent_resolution_append_only_mutation',
  'prevent_tax_decision_artifact_mutation',
  'prevent_tax_policy_control_mutation',
  'protect_financial_case_claim',
  'protect_money_desk_request_claim',
  'protect_resolution_proposal_claim',
  'safe_order_support_meta',
  'set_job_queue_updated_at',
  'set_ops_issue_updated_at',
  'set_ops_slack_delivery_updated_at',
  'set_provider_health_updated_at',
  'set_updated_at',
  'set_web_push_subscription_updated_at',
  'touch_custom_order_details_updated_at',
  'valid_reviewed_tax_source_urls',
  'validate_tax_responsibility_dependency',
]

test('pins exactly every function reported by the Production advisor', () => {
  const altered = [...sql.matchAll(/alter function public\.([a-z0-9_]+)\([^;]*?set search_path = public, pg_temp;/gisu)]
    .map((match) => match[1])
    .sort()

  assert.deepEqual(altered, expected)
  assert.equal(new Set(altered).size, 29)
})

test('uses signature-specific ALTER FUNCTION statements without replacing bodies', () => {
  assert.match(sql, /derive_seller_item_stock_status\(boolean, integer\)/u)
  assert.match(sql, /is_terminal_order_stage\(public\.order_stage\)/u)
  assert.match(sql, /valid_reviewed_tax_source_urls\(text\[\]\)/u)
  assert.doesNotMatch(sql, /create\s+(?:or\s+replace\s+)?function/iu)
})


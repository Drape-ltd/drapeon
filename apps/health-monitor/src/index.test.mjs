import assert from 'node:assert/strict'
import test from 'node:test'
import { fingerprint, nextAlertState, incidentLinks, checkTarget } from './index.mjs'

test('auth custom-domain probe verifies the production project and sends its API key', async () => {
  const originalFetch = globalThis.fetch
  let receivedKey
  let projectRef = 'wkfsrunetmgjdtcurmoj'
  globalThis.fetch = async (_url, options) => {
    receivedKey = options.headers.apikey
    return new Response(JSON.stringify({ name: 'GoTrue' }), {
      status: 200,
      headers: { 'sb-project-ref': projectRef },
    })
  }
  try {
    const target = { id: 'prod-auth-domain', name: 'Drape auth custom domain', url: 'https://auth.drapeon.co/auth/v1/health', authHealth: true }
    const result = await checkTarget(target, { SUPABASE_ANON_KEY: 'test-public-key' })
    assert.equal(receivedKey, 'test-public-key')
    assert.equal(result.ok, true)
    projectRef = 'another-project'
    assert.equal((await checkTarget(target, { SUPABASE_ANON_KEY: 'test-public-key' })).ok, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('incident links address the same durable record during failure and recovery', () => {
  const failed = incidentLinks([{ id: 'prod-ready', ok: false }])
  assert.equal(failed, incidentLinks([{ id: 'prod-ready', ok: true }]))
  const url = new URL(failed)
  assert.equal(url.searchParams.get('incidentKey'), 'synthetic:cloudflare-production-synthetic:prod-ready')
  assert.equal(url.hash, '#incident-ledger')
  assert.equal(incidentLinks([{ id: 'prod-ready' }, { id: 'prod-ready' }]), failed)
})

const slow = (latencyMs = 3_400) => [
  {
    id: 'prod-ready',
    ok: false,
    severity: 'warning',
    httpStatus: 200,
    latencyMs,
    detail: `Ready but slow (${latencyMs} ms)`,
  },
]

const healthy = [
  {
    id: 'prod-ready',
    ok: true,
    severity: 'ok',
    httpStatus: 200,
    latencyMs: 900,
    detail: 'Ready',
  },
]

const critical = [
  {
    id: 'prod-ready',
    ok: false,
    severity: 'critical',
    httpStatus: 503,
    latencyMs: 400,
    detail: 'Database readiness failed',
  },
]

test('a transient slow probe does not notify Slack', () => {
  const decision = nextAlertState(null, slow(), fingerprint(slow()))
  assert.equal(decision.event, 'NONE')
  assert.equal(decision.alertState.incidentOpen, false)
  assert.equal(decision.alertState.warningStreak, 1)
})

test('three consecutive slow probes open one warning incident', () => {
  const first = nextAlertState(null, slow(3_200), fingerprint(slow(3_200)))
  const second = nextAlertState(
    { healthy: false, alertState: first.alertState },
    slow(3_600),
    fingerprint(slow(3_600))
  )
  const third = nextAlertState(
    { healthy: false, alertState: second.alertState },
    slow(3_900),
    fingerprint(slow(3_900))
  )

  assert.equal(first.event, 'NONE')
  assert.equal(second.event, 'NONE')
  assert.equal(third.event, 'DEGRADED')
  assert.equal(third.alertState.incidentOpen, true)
})

test('two consecutive healthy probes are required before recovery', () => {
  const open = {
    healthy: false,
    alertState: {
      incidentOpen: true,
      warningStreak: 3,
      healthyStreak: 0,
      lastAlertSeverity: 'warning',
      lastAlertFingerprint: fingerprint(slow()),
    },
  }
  const first = nextAlertState(open, healthy, fingerprint(healthy))
  const second = nextAlertState(
    { healthy: true, alertState: first.alertState },
    healthy,
    fingerprint(healthy)
  )

  assert.equal(first.event, 'NONE')
  assert.equal(first.alertState.incidentOpen, true)
  assert.equal(second.event, 'RECOVERED')
  assert.equal(second.alertState.incidentOpen, false)
})

test('a critical readiness failure alerts immediately', () => {
  const decision = nextAlertState(null, critical, fingerprint(critical))
  assert.equal(decision.event, 'DEGRADED')
  assert.equal(decision.alertState.incidentOpen, true)
})

test('slow-warning fingerprints do not change with latency jitter', () => {
  assert.equal(fingerprint(slow(3_100)), fingerprint(slow(4_900)))
})

test('long failure details stay within the Ops ingest bound and retain change detection', () => {
  const failures = Array.from({ length: 3 }, (_, index) => ({
    id: `target-${index}`,
    ok: false,
    severity: 'critical',
    httpStatus: 503,
    detail: 'Readiness failed: '.padEnd(900, 'x'),
  }))
  const first = fingerprint(failures)
  assert.ok(first.length <= 200)
  assert.notEqual(first, fingerprint(failures.map((result, index) =>
    index === 1 ? { ...result, detail: `${result.detail} changed` } : result
  )))
})

import * as Sentry from '@sentry/react-native'
import type { ReadGatewayTiming } from './read-gateway'

type Outcome = 'media' | 'no_media' | 'error' | 'not_found' | 'blur' | 'timeout'

/** Measures one profile visit without recording tailor IDs, names, or media URLs. */
export function beginTailorProfileLoad(hasCachedContent: boolean) {
  const startedAt = Date.now()
  const span = Sentry.startInactiveSpan({
    name: 'Tailor profile usable content',
    op: 'ui.load',
    attributes: { 'tailor_profile.warm_content': hasCachedContent },
  })
  let finished = false
  let firstContentMs: number | null = null
  let firstMediaMs: number | null = null
  let gateway: ReadGatewayTiming | null = null
  const elapsed = () => Math.max(0, Date.now() - startedAt)
  const finish = (outcome: Outcome) => {
    if (finished) return
    finished = true
    clearTimeout(timeout)
    span?.setAttributes({
      'tailor_profile.outcome': outcome,
      'tailor_profile.total_ms': elapsed(),
      ...(firstContentMs === null ? {} : { 'tailor_profile.first_content_ms': firstContentMs }),
      ...(firstMediaMs === null ? {} : { 'tailor_profile.first_media_ms': firstMediaMs }),
      ...(gateway === null ? {} : {
        'tailor_profile.gateway_ms': gateway.durationMs,
        'tailor_profile.gateway_source': gateway.source,
      }),
    })
    span?.end()
  }
  const timeout = setTimeout(() => finish('timeout'), 15_000)

  return {
    markGateway(timing: ReadGatewayTiming) {
      if (!finished) gateway = timing
    },
    markFirstContent(hasMedia: boolean) {
      if (finished || firstContentMs !== null) return
      firstContentMs = elapsed()
      if (!hasMedia) finish('no_media')
      else if (firstMediaMs !== null) finish('media')
    },
    markFirstMedia() {
      if (finished || firstMediaMs !== null) return
      firstMediaMs = elapsed()
      if (firstContentMs !== null) finish('media')
    },
    finish,
  }
}

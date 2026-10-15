import * as Sentry from '@sentry/react-native'
import type { ReadGatewayTiming } from './read-gateway'

type ExploreLoadOutcome = 'cards' | 'empty' | 'error' | 'blur' | 'timeout'

/** One privacy-safe measurement per Explore focus or explicit refresh. */
export function beginExploreLoad(entry: 'focus' | 'refresh', hasVisibleCards: boolean) {
  const startedAt = Date.now()
  const span = Sentry.startInactiveSpan({
    name: 'Explore usable content',
    op: 'ui.load',
    attributes: {
      'explore.entry': entry,
      'explore.warm_cards': hasVisibleCards,
    },
  })
  let finished = false
  let firstCardMs: number | null = null
  let firstImageMs: number | null = null
  let gatewaySource: ReadGatewayTiming['source'] | null = null
  let gatewayMs: number | null = null

  const elapsed = () => Math.max(0, Date.now() - startedAt)
  const finish = (outcome: ExploreLoadOutcome) => {
    if (finished) return
    finished = true
    clearTimeout(timeout)
    const totalMs = elapsed()
    span?.setAttributes({
      'explore.outcome': outcome,
      'explore.total_ms': totalMs,
      ...(firstCardMs === null ? {} : { 'explore.first_card_ms': firstCardMs }),
      ...(firstImageMs === null ? {} : { 'explore.first_image_ms': firstImageMs }),
      ...(gatewaySource === null ? {} : { 'explore.gateway_source': gatewaySource }),
      ...(gatewayMs === null ? {} : { 'explore.gateway_ms': gatewayMs }),
    })
    span?.end()
    if (__DEV__) {
      console.info('[explore-perf]', {
        entry,
        outcome,
        totalMs,
        firstCardMs,
        firstImageMs,
        gatewaySource,
        gatewayMs,
      })
    }
  }
  const timeout = setTimeout(() => finish('timeout'), 15_000)

  return {
    markGateway(timing: ReadGatewayTiming) {
      if (finished) return
      gatewaySource = timing.source
      gatewayMs = timing.durationMs
    },
    markFirstCard() {
      if (finished || firstCardMs !== null) return
      firstCardMs = elapsed()
      // A previously rendered grid is already usable without another image event.
      if (hasVisibleCards || firstImageMs !== null) finish('cards')
    },
    markFirstImage() {
      if (finished || firstImageMs !== null) return
      firstImageMs = elapsed()
      if (firstCardMs !== null) finish('cards')
    },
    finish,
  }
}

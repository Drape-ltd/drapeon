'use client'

import { useState, useSyncExternalStore } from 'react'
import { ClaimAppHandoff } from './claim-app-handoff'
import { ClaimWebFlow } from './claim-web-flow'
import { isPhoneOrTablet } from '../lib/claim-device'

export function ClaimRouteChooser({ token }: { token: string }) {
  const onMobileDevice = useSyncExternalStore(
    () => () => {},
    () => isPhoneOrTablet(navigator.userAgent, navigator.platform, navigator.maxTouchPoints),
    () => null
  )
  const [routeOverride, setRouteOverride] = useState<'app' | 'web' | null>(null)
  const [claimed, setClaimed] = useState(false)

  if (onMobileDevice === null) {
    return (
      <p className="mx-auto mt-5 max-w-2xl text-center text-sm text-ink/60">
        Preparing your claim options…
      </p>
    )
  }

  const route = routeOverride ?? (onMobileDevice ? 'app' : 'web')

  return (
    <div className="mx-auto max-w-2xl">
      {/* Keep the inactive form mounted so switching routes preserves entered details. Its effects never call the claim server. */}
      <div hidden={route !== 'app' || claimed}>
        <ClaimAppHandoff token={token} onMobileDevice={onMobileDevice} />
      </div>
      <div hidden={route !== 'web' && !claimed}>
        <ClaimWebFlow
          token={token}
          onMobileDevice={onMobileDevice}
          onClaimed={() => setClaimed(true)}
        />
      </div>
      {!claimed ? (
        <div className="mt-4 text-center">
          <button
            className="text-sm font-semibold text-needle underline underline-offset-4"
            type="button"
            onClick={() => setRouteOverride(route === 'app' ? 'web' : 'app')}
          >
            {route === 'app' ? 'Continue in this browser instead' : 'Use the app instead'}
          </button>
        </div>
      ) : null}
    </div>
  )
}

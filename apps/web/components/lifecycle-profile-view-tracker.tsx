'use client'

import { useEffect } from 'react'
import { trackLifecycleEvent, useWebAnalyticsConsent } from './web-analytics'

type LifecycleProfileViewTrackerProps = {
  tailorId: string
  mediaReady: boolean
  enabled?: boolean
  profileVariant?: string
}

export async function hashLifecycleIdentifier(value: string): Promise<string | null> {
  if (!value.trim() || typeof window === 'undefined' || !window.crypto?.subtle) return null
  try {
    const bytes = new TextEncoder().encode(value)
    const digest = await window.crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 16)
  } catch {
    return null
  }
}

export function LifecycleProfileViewTracker({
  tailorId,
  mediaReady,
  enabled = true,
  profileVariant = 'public',
}: LifecycleProfileViewTrackerProps): null {
  const consent = useWebAnalyticsConsent()

  useEffect(() => {
    if (!enabled || consent !== 'granted' || !mediaReady) return
    let active = true
    void hashLifecycleIdentifier(tailorId).then((tailorIdHash) => {
      if (!active || !tailorIdHash) return
      trackLifecycleEvent('tailor_profile_viewed', {
        tailor_id_hash: tailorIdHash,
        entry_surface: 'web',
        media_ready: true,
        profile_variant: profileVariant,
      })
    })
    return () => {
      active = false
    }
  }, [consent, enabled, mediaReady, profileVariant, tailorId])

  return null
}

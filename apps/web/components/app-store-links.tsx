import { DRAPEON_ANDROID_STORE_URL, DRAPEON_IOS_STORE_URL } from '@drape/shared/email-links'
import type { IconType } from 'react-icons'
import { FaApple, FaGooglePlay } from 'react-icons/fa'

type AppStoreLinksProps = {
  /** `light` sits on white or canvas surfaces; `dark` on the footer, image, and needle bands. */
  tone?: 'light' | 'dark'
  /** Optional line above the badges. */
  label?: string
  /** Prefixes the analytics label so each placement reports separately. */
  placement: string
  className?: string
}

// The store URLs are region-neutral, so each store opens the visitor's own
// storefront. They are shared with the transactional emails.
const stores: Array<{ key: string; href: string; icon: IconType; kicker: string; name: string }> = [
  { key: 'ios', href: DRAPEON_IOS_STORE_URL, icon: FaApple, kicker: 'Download on the', name: 'App Store' },
  { key: 'android', href: DRAPEON_ANDROID_STORE_URL, icon: FaGooglePlay, kicker: 'Get it on', name: 'Google Play' },
]

export function AppStoreLinks({
  tone = 'light',
  label,
  placement,
  className = '',
}: AppStoreLinksProps): React.JSX.Element {
  const dark = tone === 'dark'
  return (
    <div className={className}>
      {label ? <p className={`mb-3 text-sm ${dark ? 'text-white/70' : 'text-ink/60'}`}>{label}</p> : null}
      <div className="flex flex-wrap gap-3">
        {stores.map((store) => (
          <a
            key={store.key}
            href={store.href}
            target="_blank"
            rel="noopener noreferrer"
            data-analytics-event="app_store_click"
            data-analytics-label={`${placement} ${store.name}`}
            className={`inline-flex min-h-12 items-center gap-2.5 rounded-xl px-4 py-2 text-white transition ${
              dark ? 'border border-white/25 bg-white/5 hover:bg-white/10' : 'bg-ink hover:bg-ink/85'
            }`}
          >
            <store.icon aria-hidden="true" className="size-6 shrink-0" />
            <span className="text-left leading-none">
              <span className="block text-xs [font-family:var(--font-display)] font-medium tracking-[0.02em] text-white/75">{store.kicker}</span>
              {/* Keeps the link's name "Download on the App Store", not "theApp". */}
              {' '}
              <span className="mt-1 block text-base [font-family:var(--font-display)] font-semibold">{store.name}</span>
            </span>
          </a>
        ))}
      </div>
    </div>
  )
}

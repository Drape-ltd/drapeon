import type { IconType } from 'react-icons'
import { FaApple } from 'react-icons/fa'
import { FcGoogle } from 'react-icons/fc'

type OAuthProvider = 'apple' | 'google'

const PROVIDERS: Record<OAuthProvider, { name: string; Icon: IconType }> = {
  apple: { name: 'Apple', Icon: FaApple },
  google: { name: 'Google', Icon: FcGoogle },
}

// The stacked buttons reproduce the original sign-up treatment class for class.
const STACK_CLASS: Record<OAuthProvider, string> = {
  apple: 'inline-flex min-h-[52px] items-center justify-center gap-3 rounded-full bg-black px-5 py-3 text-sm font-semibold text-white transition hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-50',
  google: 'inline-flex min-h-[52px] items-center justify-center gap-3 rounded-full border border-ink/12 bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:bg-bone disabled:cursor-not-allowed disabled:opacity-50',
}

const ROW_CLASS =
  'inline-flex min-h-12 flex-1 items-center justify-center gap-2.5 rounded-full border border-ink/10 bg-white px-4 text-sm font-semibold text-ink transition hover:bg-bone disabled:cursor-not-allowed disabled:opacity-50'

/**
 * Apple and Google sign-in buttons. `stack` is the full-width "Continue with…"
 * treatment sign-up uses; `row` is a compact pair showing only the icon and
 * provider name. A row button still announces "Continue with Google", so the
 * visible name sits inside the accessible name and existing selectors match.
 */
export function OAuthProviderButtons({
  layout,
  appleEnabled,
  googleEnabled,
  providerLoading,
  disabled,
  onSelect,
}: {
  layout: 'stack' | 'row'
  appleEnabled: boolean
  googleEnabled: boolean
  providerLoading: OAuthProvider | null
  disabled: boolean
  onSelect: (provider: OAuthProvider) => void
}): React.JSX.Element | null {
  const enabled = (['apple', 'google'] as const).filter((provider) =>
    provider === 'apple' ? appleEnabled : googleEnabled,
  )
  if (enabled.length === 0) return null

  const buttons = enabled.map((provider) => {
    const { name, Icon } = PROVIDERS[provider]
    const opening = providerLoading === provider
    const row = layout === 'row'
    return (
      <button
        key={provider}
        type="button"
        onClick={() => onSelect(provider)}
        disabled={disabled}
        aria-label={row ? (opening ? `Opening ${name}…` : `Continue with ${name}`) : undefined}
        className={row ? ROW_CLASS : STACK_CLASS[provider]}
      >
        <Icon aria-hidden="true" className="size-5 shrink-0" />
        {row ? (opening ? 'Opening…' : name) : opening ? `Opening ${name}…` : `Continue with ${name}`}
      </button>
    )
  })

  return layout === 'row' ? <div className="flex flex-wrap gap-3">{buttons}</div> : <>{buttons}</>
}

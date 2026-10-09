import { CONTACTS, buildWhatsAppSupportUrl } from '@drape/shared'
import Link from 'next/link'
import type { Route } from 'next'
import { publicPhoneE164 } from '../lib/metadata'
import { SocialIconLinks } from './social-links'

const productLinks: Array<{ href: Route; label: string }> = [
  { href: '/explore', label: 'Explore' },
  { href: '/how-it-works', label: 'How it works' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/help', label: 'Help center' },
  { href: '/faq', label: 'FAQ' },
  { href: '/whats-new', label: "What's new" },
  { href: '/vision', label: 'Drapeon Vision' },
  { href: '/tailors', label: 'For tailors' },
  { href: '/sign-up?role=TAILOR', label: 'Join as a tailor' },
  { href: '/sign-up', label: 'Create account' },
]

const companyLinks: Array<{ href: Route; label: string }> = [
  { href: '/about', label: 'About' },
  { href: '/press', label: 'Press' },
  { href: '/status', label: 'Service status' },
  { href: '/contact', label: 'Contact' },
  { href: '/partnerships', label: 'Partnerships' },
]

const legalLinks: Array<{ href: Route; label: string }> = [
  { href: '/privacy', label: 'Privacy & cookies' },
  { href: '/terms', label: 'Terms' },
  { href: '/security', label: 'Security' },
  { href: '/trust', label: 'Trust' },
  { href: '/payouts', label: 'Payouts' },
]

const linkGroups = [
  { title: 'Product', links: productLinks },
  { title: 'Company', links: companyLinks },
  { title: 'Legal', links: legalLinks },
] as const

/**
 * Full-bleed site footer. Render it as a sibling after `<main>`, never inside
 * it: a `<footer>` nested in `<main>` loses its `contentinfo` landmark role,
 * which the public-navigation e2e spec uses to find these links.
 */
export function SiteFooter(): React.JSX.Element {
  return (
    <footer className=" bg-illustration-frame-canvas text-white">
      <div className="mx-auto max-w-[92rem] px-5 pb-8 pt-14 sm:px-8 sm:pt-16 lg:pt-20">
        <div className="grid gap-12 lg:grid-cols-[1.1fr_1.9fr] lg:gap-16">
          <div className="max-w-sm">
            {/* Set in the heading face so the brand reads like the page headlines. */}
            <p className="text-4xl leading-none text-white [font-family:var(--font-display)] sm:text-5xl">Drapeon</p>
            <p className="mt-4 text-sm leading-6 text-white/60">Custom tailoring, made global—from first idea to delivery.</p>
            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-white/60">
              <a href={`mailto:${CONTACTS.support}`} className="transition hover:text-white">{CONTACTS.support}</a>
              <a href={buildWhatsAppSupportUrl('Hi Drapeon, I need support.')} target="_blank" rel="noopener noreferrer" className="transition hover:text-white">WhatsApp</a>
              <a href={`tel:${publicPhoneE164}`} className="transition hover:text-white">Call or text</a>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <SocialIconLinks size="sm" theme="dark" />
            </div>
          </div>

          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3">
            {linkGroups.map((group) => (
              <div key={group.title}>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-illustration-highlight-muted">{group.title}</p>
                <ul className="mt-4 grid gap-2.5">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} prefetch={false} className="text-sm text-white/70 transition hover:text-white">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        {/* white/55 is the floor here: white/45 drops to 4.39:1 on this canvas. */}
        <div className="mt-14 flex flex-col gap-3 border-t border-white/12 pt-6 text-xs text-white/55 sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 O4 Group LLC. All rights reserved.</span>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/account-deletion" prefetch={false} className="transition hover:text-white">Account deletion</Link>
            <a href={`mailto:${CONTACTS.hello}`} className="transition hover:text-white">{CONTACTS.hello}</a>
          </div>
        </div>
      </div>
    </footer>
  )
}

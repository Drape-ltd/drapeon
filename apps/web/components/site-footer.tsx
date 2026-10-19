import { CONTACTS, WHATSAPP_SUPPORT, buildWhatsAppSupportUrl } from '@drape/shared'
import { Mail, Phone } from 'lucide-react'
import Link from 'next/link'
import type { Route } from 'next'
import { publicPhoneE164 } from '../lib/metadata'
import { SocialIconLinks } from './social-links'

// lucide-react ships no brand marks, so the WhatsApp glyph is the Simple Icons
// path (CC0), drawn in currentColor to match the lucide icons beside it.
function WhatsAppIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-4" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}

// WhatsApp and the call line share one number, so each link carries a
// screen-reader prefix: otherwise both would announce as the same digits.
const contactLinks = [
  {
    key: 'email',
    href: `mailto:${CONTACTS.support}`,
    srLabel: 'Email support:',
    text: CONTACTS.support,
    icon: <Mail aria-hidden="true" className="size-4" />,
    external: false,
  },
  {
    key: 'whatsapp',
    href: buildWhatsAppSupportUrl('Hi Drapeon, I need support.'),
    srLabel: 'Message us on WhatsApp:',
    text: WHATSAPP_SUPPORT.phoneDisplay,
    icon: <WhatsAppIcon />,
    external: true,
  },
  {
    key: 'phone',
    href: `tel:${publicPhoneE164}`,
    srLabel: 'Call or text:',
    text: WHATSAPP_SUPPORT.phoneDisplay,
    icon: <Phone aria-hidden="true" className="size-4" />,
    external: false,
  },
] as const

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
            <ul className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-white/70">
              {contactLinks.map((contact) => (
                <li key={contact.key}>
                  <a
                    href={contact.href}
                    {...(contact.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                    className="group inline-flex items-center gap-2 transition hover:text-white"
                  >
                    <span className="shrink-0 text-illustration-highlight-muted transition group-hover:text-white">
                      {contact.icon}
                    </span>
                    <span>
                      <span className="sr-only">{contact.srLabel} </span>
                      {contact.text}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
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

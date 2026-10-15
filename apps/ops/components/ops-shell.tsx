'use client'

import {
  AlertTriangle,
  Banknote,
  BookOpen,
  Boxes,
  ChartNoAxesCombined,
  ChevronDown,
  ClipboardList,
  Factory,
  HeartPulse,
  KeyRound,
  LogOut,
  MessageSquareText,
  PackageCheck,
  Ruler,
  ShieldCheck,
  Store,
  Users,
} from 'lucide-react'
import { usePathname, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { Route } from 'next'
import type { ReactNode } from 'react'
import { OpsPwaControl } from './ops-pwa-control'
import { OpsCommandPalette } from './ops-command-palette'
import { canAccessOpsArea, type OpsArea } from '../lib/route-access-policy'

type NavItem = { href: string; label: string; icon: typeof ClipboardList; mobileSafe?: boolean; area?: OpsArea }
type NavGroup = { label: string; items: NavItem[]; icon?: typeof ClipboardList }

const groups: NavGroup[] = [
  {
    label: 'Work',
    items: [
      { href: '/ops/my-work?ownership=mine', label: 'Inbox', icon: ClipboardList, mobileSafe: true },
      { href: '/ops/queues/all', label: 'All cases', icon: Boxes, mobileSafe: true },
      { href: '/ops/queues/trust?caseType=TAILOR_VERIFICATION', label: 'Tailor approvals', icon: ShieldCheck, area: 'trust' },
      { href: '/ops/orders', label: 'Orders', icon: Factory, area: 'orders' },
      { href: '/ops/money', label: 'Money', icon: Banknote, area: 'money' },
    ],
  },
  {
    label: 'People', icon: Users,
    items: [
      { href: '/ops/customers', label: 'Customers', icon: Users, area: 'customers' },
      { href: '/ops/tailors', label: 'Tailors', icon: Store, area: 'tailors' },
    ],
  },
  {
    label: 'System health', icon: HeartPulse,
    items: [
      { href: '/ops/incidents', label: 'Incidents', icon: AlertTriangle, mobileSafe: true, area: 'incidents' },
      { href: '/ops/providers', label: 'Providers & Jobs', icon: HeartPulse, area: 'providers' },
    ],
  },
  {
    label: 'More', icon: Boxes,
    items: [
      { href: '/ops/delivery', label: 'Delivery & Supply', icon: PackageCheck, area: 'delivery' },
      { href: '/ops/communications', label: 'Communications', icon: MessageSquareText, area: 'communications' },
      { href: '/ops/vision', label: 'Measurements & Vision', icon: Ruler, area: 'vision' },
      { href: '/ops/trust', label: 'Trust & Safety', icon: ShieldCheck, area: 'trust' },
      { href: '/ops/overview', label: 'Overview', icon: ChartNoAxesCombined, area: 'overview' },
      { href: '/ops/reports', label: 'Reports & Audit', icon: ClipboardList, area: 'reports' },
      { href: '/ops/knowledge', label: 'Knowledge', icon: BookOpen, mobileSafe: true },
      { href: '/ops/admin/access', label: 'Admin & access', icon: KeyRound, area: 'access' },
    ],
  },
]

function isActive(pathname: string, href: string, search: URLSearchParams) {
  const [route, query] = href.split('?')
  if (query && !Array.from(new URLSearchParams(query)).every(([key, value]) => search.get(key) === value)) return false
  return pathname === route || (route !== '/ops/my-work' && pathname.startsWith(`${route}/`))
}

export function OpsShell({
  children,
  email,
  role,
  environment,
  accessKeyState,
  accessKeyAgeMs,
}: {
  children: ReactNode
  email: string
  role: string
  environment: 'development' | 'production'
  accessKeyState: 'fresh' | 'stale' | 'not-applicable'
  accessKeyAgeMs: number | null
}) {
  const pathname = usePathname()
  const search = useSearchParams()
  const initials = email.split('@')[0]?.split(/[._-]/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'OP'
  const permittedGroups = groups
    .map((group) => ({ ...group, items: group.items.filter((item) => !item.area || canAccessOpsArea(role, item.area)) }))
    .filter((group) => group.items.length > 0)
  const commandDestinations = permittedGroups.flatMap((group) => group.items.map((item) => ({
    group: group.label,
    href: item.href,
    label: item.label,
    mobileSafe: Boolean(item.mobileSafe),
  })))
  const staleAccessKeys = accessKeyState === 'stale'
  const accessKeyAgeMinutes = accessKeyAgeMs == null ? null : Math.max(1, Math.ceil(accessKeyAgeMs / 60_000))
  function navLink(item: NavItem) {
    const Icon = item.icon
    const active = isActive(pathname, item.href, search)
    return <Link key={item.href} href={item.href as Route} className="ops-nav-link"
      data-active={active} data-mobile-safe={item.mobileSafe ? 'true' : 'false'}
      aria-current={active ? 'page' : undefined} title={item.label} aria-label={item.label}>
      <Icon aria-hidden="true" /><span>{item.label}</span>
    </Link>
  }

  return (
    <div className="ops-app">
      <aside className="ops-sidebar" aria-label="Ops navigation">
        <Link href="/ops/my-work?ownership=mine" className="ops-brand" aria-label="Drapeon Ops home">
          <span className="ops-brand-mark"><ShieldCheck size={17} aria-hidden="true" /></span>
          <span>Drapeon Ops</span>
        </Link>
        <nav className="ops-desktop-nav" aria-label="Workspaces">
          {permittedGroups.map((group) => {
            const GroupIcon = group.icon
            const active = group.items.some((item) => isActive(pathname, item.href, search))
            return GroupIcon ? <details className="ops-nav-disclosure" key={`${group.label}:${pathname}`} open={active}>
              <summary className="ops-nav-link" data-active={active} title={group.label} aria-label={group.label}>
                <GroupIcon aria-hidden="true" /><span>{group.label}</span><ChevronDown className="ops-nav-chevron" aria-hidden="true" />
              </summary>
              <div className="ops-nav-children">{group.items.map(navLink)}</div>
            </details> : <section className="ops-nav-group" key={group.label} aria-label={group.label}>
              {group.items.map(navLink)}
            </section>
          })}
        </nav>
        <nav className="ops-mobile-nav" aria-label="Phone workspaces">
          {permittedGroups.flatMap((group) => group.items.filter((item) => item.mobileSafe)).map(navLink)}
        </nav>
      </aside>
      <div className="ops-main">
        <header className="ops-topbar">
          <OpsCommandPalette destinations={commandDestinations} />
          <span className="ops-env"><span className="ops-env-dot" />{environment}</span>
          <span className="ops-health" data-tone={staleAccessKeys ? 'warning' : 'healthy'} title={staleAccessKeys ? 'Cloudflare signing-key refresh is degraded; protected actions are locked.' : 'Named workforce identity verified.'}><span className="ops-health-dot" />{staleAccessKeys ? 'Access refresh degraded' : 'Workforce verified'}</span>
          <OpsPwaControl />
          <form action="/ops/logout" method="post">
            <button className="ops-pwa-install ops-sign-out" type="submit" aria-label="Sign out of Drapeon Ops" title="Sign out of Drapeon Ops">
              <LogOut size={14} aria-hidden="true" />
              <span>Sign out</span>
            </button>
          </form>
          <span className="ops-avatar" title={`${email} · ${role}`} aria-label={`${email}, ${role}`}>{initials}</span>
        </header>
        {staleAccessKeys ? <div className="ops-auth-health-banner" role="alert"><AlertTriangle size={16} /><span><strong>Access signing-key refresh is degraded.</strong> This session used a previously trusted key set{accessKeyAgeMinutes ? ` refreshed ${accessKeyAgeMinutes} minutes ago` : ''}. Sensitive actions remain locked until Cloudflare keys refresh successfully.</span></div> : null}
        <main id="ops-content" className="ops-content" tabIndex={-1}>{children}</main>
      </div>
    </div>
  )
}

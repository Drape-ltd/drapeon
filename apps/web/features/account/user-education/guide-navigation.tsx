'use client'
import { usePathname, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { Route } from 'next'
import { GUIDE_ROOMS } from '@drape/shared/guide-library'
export function safeGuideReturn(value: string | null, fallback = '/guide') {
  if (
    !value ||
    value.length > 2000 ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[\\\r\n]/.test(value)
  )
    return fallback
  return /^\/(guide|account|studio|vision|explore)(?:[/?#]|$)/.test(value) ? value : fallback
}
export function GuideBack({ library = false }: { library?: boolean }) {
  const params = useSearchParams()
  const target = safeGuideReturn(params.get('returnTo'), library ? '/explore' : '/guide')
  const returnParams = new URL(target, 'https://drapeon.local').searchParams
  const room = target.startsWith('/guide')
    ? GUIDE_ROOMS.find((item) => item.category === returnParams.get('topic'))
    : undefined
  const isMessageReturn = /^\/account\/messages(?:[/?#]|$)/.test(target)
  return (
    <Link href={target as Route} className="inline-flex min-h-11 items-center text-sm text-needle">
      ←{' '}
      {library
        ? 'Back to where you were'
        : target.startsWith('/guide/')
          ? 'Back to previous guide'
          : isMessageReturn
            ? 'Back to conversation'
          : room
            ? `Back to ${room.title}`
            : target.startsWith('/guide')
              ? 'Back to Guide'
              : 'Back to your task'}
    </Link>
  )
}
export function GuideContextLink({
  id,
  children,
  className,
}: {
  id: string
  children: React.ReactNode
  className?: string
}) {
  const path = usePathname(),
    params = useSearchParams()
  const source = `${path}${params.toString() ? '?' + params.toString() : ''}`
  return (
    <Link
      className={className}
      href={`/guide/${id}?returnTo=${encodeURIComponent(safeGuideReturn(source))}` as Route}
    >
      {children}
    </Link>
  )
}

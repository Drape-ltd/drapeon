import { ArrowLeft } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { opsContextReturn } from '../lib/context-return.mjs'

export function ContextBackLink({ returnTo, fallback, label }: { returnTo?: string; fallback: Route; label: string }) {
  const target = opsContextReturn(returnTo)
  return <Link className="ops-back-link" href={(target ?? fallback) as Route}><ArrowLeft size={14} />{target ? 'Back to previous record' : label}</Link>
}

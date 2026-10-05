'use client'
import Link from 'next/link'
import type { Route } from 'next'
import { BookOpen } from 'lucide-react'
import { VisionToolIcon } from './tool-icons'
export function EducationTools({ returnTo = '/explore' }: { returnTo?: string }) {
  return (
    <nav id="education-tools" aria-label="Tools and guides" className="my-4 flex flex-wrap gap-2">
      {[
        { label: 'Vision', path: '/vision', Icon: VisionToolIcon },
        { label: 'Guide', path: `/guide?returnTo=${encodeURIComponent(returnTo)}`, Icon: BookOpen },
      ]
        .map(({ label, path, Icon }) => (
          <Link
            key={label}
            href={path as Route}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-needle/20 bg-white px-4 py-2 text-sm font-semibold text-needle"
          >
            <Icon size={16} />
            {label}
          </Link>
        ))}
    </nav>
  )
}

'use client'
import { useState } from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import { parseGuideReferences } from '@drape/shared/guide-library'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '../../../components/ui/dialog'
import { GuideLibrary } from './guide-library'
export function GuidePicker({
  onSelect,
  disabled,
}: {
  onSelect: (body: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="min-h-10 rounded-full px-3 text-xs font-semibold text-needle"
      >
        Send a guide
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl">
          <DialogTitle>Choose a guide</DialogTitle>
          <DialogDescription>
            Add instructions to your draft, then write a note and send when ready.
          </DialogDescription>
          <GuideLibrary
            onSelect={(body) => {
              onSelect(body)
              setOpen(false)
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
export function GuideMessageCards({ body, returnTo }: { body: string; returnTo: string }) {
  const refs = parseGuideReferences(body)
  if (!refs.length) return null
  return (
    <div className="grid gap-2">
      {refs.map((r, i) => (
          <Link
            key={`${r.guide.id}-${i}`}
            href={`/guide/${r.guide.id}?${new URLSearchParams({ returnTo }).toString()}${r.section ? `#${r.section}` : ''}` as Route}
            className="rounded-xl border border-needle/20 bg-[#f7f5ed] p-4 text-left text-needle"
          >
            <span className="block text-[10px] font-bold uppercase tracking-widest">
              Drapeon Guide
            </span>
            <span className="mt-1 block font-semibold">{r.guide.title}</span>
            {r.section && (
              <span className="block text-xs">
                {r.guide.sections.find((s) => s.id === r.section)?.title}
              </span>
            )}
            <span className="mt-2 block text-xs underline">Open guide</span>
          </Link>
      ))}
    </div>
  )
}

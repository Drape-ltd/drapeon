'use client'
import { guideOfflineHtml } from '@drape/shared/guide-offline'
import { useState } from 'react'
import { type GuideArticle, guidePublicUrl } from '@drape/shared/guide-library'
import { collectionsFrom } from '@drape/shared/education-state'
import { useEducation } from './use-education'
export function GuideActions({ guide, section }: { guide: GuideArticle; section?: string }) {
  const { state, store, owner } = useEducation(),
    [notice, setNotice] = useState('')
  const saved = state.data[`saved:${guide.id}`] === true
  const share = async () => {
    try {
      await navigator.clipboard.writeText(guidePublicUrl(guide.id, section))
      setNotice('Link copied. Anyone can read it without signing in.')
    } catch {
      setNotice(`Copy this link: ${guidePublicUrl(guide.id, section)}`)
    }
  }
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([guideOfflineHtml(guide)], { type: 'text/html;charset=utf-8' })
    )
    const a = document.createElement('a')
    a.href = url
    a.download = `drapeon-guide-${guide.id}.html`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
    setNotice('Offline copy prepared. Keep the downloaded HTML file to read without a connection.')
  }
  return (
    <div className="my-3 space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {!section && (
          <button
            type="button"
            disabled={!state.ready}
            aria-pressed={saved}
            onClick={() => {
              void store?.set(`saved:${guide.id}`, !saved).catch(() => {})
            }}
            className="min-h-11 rounded-full border border-needle/25 px-4 text-needle"
          >
            {saved ? 'Saved · remove' : 'Save guide'}
          </button>
        )}
        <button
          type="button"
          onClick={() => void share()}
          className="min-h-11 text-needle underline"
        >
          {section ? 'Copy link to this section' : 'Share guide'}
        </button>
        {!section && (
          <button type="button" onClick={download} className="min-h-11 text-needle underline">
            Download offline copy
          </button>
        )}
        {!section && collectionsFrom(state.data).length > 0 && (
          <select
            aria-label="Add to collection"
            className="min-h-11 rounded-lg border p-2"
            value=""
            onChange={(e) => {
              const entry = collectionsFrom(state.data).find(([key]) => key === e.target.value)
              if (entry) {
                const ids = [...new Set([...entry[1].guideIds, guide.id])]
                if (ids.length > 8) {
                  setNotice('A collection holds up to eight guides.')
                  return
                }
                void store
                  ?.set(entry[0], { ...entry[1], guideIds: ids })
                  .then(() => setNotice('Added to collection.'))
                  .catch(() => {})
              }
            }}
          >
            <option value="">Add to collection…</option>
            {collectionsFrom(state.data).map(([key, c]) => (
              <option key={key} value={key}>
                {c.title}
              </option>
            ))}
          </select>
        )}
      </div>
      <p role="status" className="text-xs leading-5 text-ink/60">
        {notice ||
          (!section
            ? state.error ||
              (state.syncing
                ? 'Syncing…'
                : owner
                  ? state.pending
                    ? 'Saved on this device · account sync pending'
                    : 'Preferences sync with your account.'
                  : 'Saved on this browser. Sign in to keep a separate account library across devices.')
            : '')}
      </p>
      {!section && state.error && (
        <button type="button" onClick={() => void store?.sync()} className="text-sm underline">
          Retry sync
        </button>
      )}
    </div>
  )
}

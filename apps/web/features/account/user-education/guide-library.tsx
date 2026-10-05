'use client'
import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import styles from './guide.module.css'
import { GuideContextLink } from './guide-navigation'

import { GUIDE_ROOMS, getGuide, searchGuides, guideShareText } from '@drape/shared/guide-library'
import { collectionsFrom } from '@drape/shared/education-state'
import { useEducation } from './use-education'
import { EducationHelp } from './education-help'
function GuideLibraryBody({ onSelect }: { onSelect?: (body: string) => void }) {
  const params = useSearchParams()
  const [query, updateQuery] = useState(onSelect ? '' : params.get('q') || ''),
    [category, updateCategory] = useState(onSelect ? '' : params.get('topic') || ''),
    [tab, updateTab] = useState(onSelect ? 'Explore' : params.get('view') || 'Explore'),
    [title, setTitle] = useState('')
  const remember = (key: string, value: string) => {
    if (onSelect) return
    const next = new URLSearchParams(window.location.search)
    if (value) next.set(key, value)
    else next.delete(key)
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${next.size ? '?' + next.toString() : ''}`
    )
  }
  const setQuery = (value: string) => {
    updateQuery(value)
    remember('q', value)
  }
  const setCategory = (value: string) => {
    updateCategory(value)
    remember('topic', value)
  }
  const setTab = (value: string) => {
    updateTab(value)
    remember('view', value)
  }
  const { state, store, owner } = useEducation()
  const guides = searchGuides(query, category).filter(
    (g) => tab !== 'Saved' || state.data[`saved:${g.id}`] === true
  )
  const collections = collectionsFrom(state.data)
  return (
    <div className={`${styles.library} ${onSelect ? styles.picker : ''}`}>
      <div className={styles.bar}>
        <div className={styles.tabs} role="group" aria-label="Library views">
          {['Explore', 'Saved', 'My collections'].map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className={`${styles.tab} ${tab === t ? styles.active : ''}`}
            >
              {t}
            </button>
          ))}
        </div>
        <span className={styles.sync}>
          {!state.ready
            ? 'Opening your library…'
            : state.syncing
              ? 'Syncing…'
              : owner
                ? state.pending
                  ? 'Changes saved here · sync pending'
                  : 'Your personal library'
                : 'Guest library · saved on this browser'}
        </span>
      </div>
      {state.error && (
        <div className={styles.error} role="status">
          {state.error}{' '}
          <button type="button" onClick={() => void store?.sync()} className="underline">
            Retry sync
          </button>
        </div>
      )}
      {tab === 'My collections' ? (
        <section className="space-y-4">
          <p className="text-sm leading-6">
            Group up to eight guides in reading order. Add guides from their reading page.
            Collections stay private; sending one shares only its selected guides.
          </p>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (!title.trim()) return
              void store
                ?.set(`collection:${crypto.randomUUID()}`, {
                  title: title.trim().slice(0, 80),
                  guideIds: [],
                })
                .then(() => setTitle(''))
                .catch(() => {})
            }}
          >
            <input
              aria-label="Collection name"
              maxLength={80}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Before your fitting"
              className="min-h-11 flex-1 rounded-xl border p-3"
            />
            <button
              disabled={!state.ready || !title.trim() || collections.length >= 30}
              className="rounded-full bg-needle px-5 py-3 text-white"
            >
              Create collection
            </button>
          </form>
          {!collections.length && (
            <p className="rounded-xl bg-white p-6">
              Your collections will appear here. Start with the instructions you send most often.
            </p>
          )}
          {collections.map(([key, c]) => (
            <article
              key={key}
              className="space-y-3 rounded-xl border border-needle/15 bg-white p-5"
            >
              <h2 className="text-xl">{c.title}</h2>
              <ol className="space-y-3">
                {c.guideIds.map((id, index) => (
                  <li key={id} className="flex flex-wrap items-center gap-3">
                    <span className="flex-1 text-sm text-needle underline">
                      <GuideContextLink id={id}>
                        {getGuide(id)?.title || 'Unavailable guide'}
                      </GuideContextLink>
                    </span>
                    {index > 0 && (
                      <button
                        type="button"
                        className="text-xs underline"
                        aria-label={`Move ${getGuide(id)?.title} earlier`}
                        onClick={() => {
                          const ids = [...c.guideIds]
                          ;[ids[index - 1], ids[index]] = [ids[index]!, ids[index - 1]!]
                          void store?.set(key, { ...c, guideIds: ids }).catch(() => {})
                        }}
                      >
                        Move up
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-xs underline"
                      aria-label={`Remove ${getGuide(id)?.title}`}
                      onClick={() =>
                        void store
                          ?.set(key, { ...c, guideIds: c.guideIds.filter((g) => g !== id) })
                          .catch(() => {})
                      }
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ol>
              {!c.guideIds.length && (
                <p className="text-sm text-ink/60">Open a guide and choose Add to collection.</p>
              )}
              {onSelect && c.guideIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => onSelect(guideShareText(c.guideIds))}
                  className="rounded-full bg-needle px-4 py-2 text-white"
                >
                  Add collection to message
                </button>
              )}
              <button
                type="button"
                onClick={() => void store?.set(key, null).catch(() => {})}
                className="block text-xs text-ink/60 underline"
              >
                Delete this collection
              </button>
            </article>
          ))}
        </section>
      ) : (
        <div className={styles.roomBrowser}>
          <section>
            <input
              type="search"
              aria-label="Search guides"
              placeholder="What would you like help with?"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={styles.search}
            />
            {!category && !query && tab === 'Explore' ? (
              <div className={styles.roomGrid}>
                {GUIDE_ROOMS.map((room) => (
                  <button
                    type="button"
                    className={styles.room}
                    key={room.category}
                    onClick={() => setCategory(room.category)}
                  >
                    <span className={styles.eyebrow}>
                      {searchGuides('', room.category).length} sections
                    </span>
                    <h2>{room.title}</h2>
                    <p>{room.description}</p>
                    <span className={styles.roomTopics}>{room.topics}</span>
                    <span className={styles.read}>Open guide →</span>
                  </button>
                ))}
              </div>
            ) : (
              <>
                {category && (
                  <div className={styles.roomHeading}>
                    <button
                      type="button"
                      onClick={() => {
                        setCategory('')
                        setQuery('')
                      }}
                      className={styles.quiet}
                    >
                      ← All guide rooms
                    </button>
                    <h2>{GUIDE_ROOMS.find((r) => r.category === category)?.title || category}</h2>
                    <p>{GUIDE_ROOMS.find((r) => r.category === category)?.description}</p>
                  </div>
                )}
                <p className={styles.count} aria-live="polite">
                  {query ? `Results for “${query}”` : category || 'Find your next useful lesson'} ·{' '}
                  {guides.length} guides
                </p>
                <div className={styles.lessonList}>
                  {guides.map((g, index) => (
                    <article key={g.id} className={styles.lesson}>
                      <span className={styles.lessonNumber}>
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <div>
                        <span className={styles.eyebrow}>
                          {g.category} · {g.minutes} min
                        </span>
                        <h2>
                          {onSelect ? (
                            g.title
                          ) : (
                            <GuideContextLink id={g.id}>{g.title}</GuideContextLink>
                          )}
                        </h2>
                        <p>{g.summary}</p>
                        {onSelect ? (
                          <button
                            type="button"
                            onClick={() => onSelect(guideShareText([g.id]))}
                            className={styles.read}
                          >
                            Add to message +
                          </button>
                        ) : (
                          <div className={styles.read}>
                            <GuideContextLink id={g.id}>Read guide →</GuideContextLink>
                          </div>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
                {!guides.length && (
                  <p className={styles.empty}>
                    {tab === 'Saved'
                      ? 'Your useful lessons, all in one place. Open a guide and choose Save to add it here.'
                      : 'No guides match that search. Try a shorter phrase or choose another topic.'}
                  </p>
                )}
              </>
            )}
          </section>
        </div>
      )}
      {!onSelect && (
        <details className={styles.start}>
          <summary>New to Drapeon? Take a short introduction</summary>
          <EducationHelp />
        </details>
      )}
    </div>
  )
}
export function GuideLibrary(props: { onSelect?: (body: string) => void }) {
  return (
    <Suspense fallback={<p>Opening Guide…</p>}>
      <GuideLibraryBody {...props} />
    </Suspense>
  )
}

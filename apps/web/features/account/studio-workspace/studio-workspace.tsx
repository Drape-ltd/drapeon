'use client'

import { StudioGuestPreview } from './studio-guest-preview'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import { createClient } from '../../../lib/supabase'
import {
  parseSavedLooks,
  studioStorageKey,
  studioDraftKey,
  parseDraft,
  MAX_STUDIO_BYTES,
  parseStudioBriefHandoff,
} from '../../../../../packages/drape-studio/src/studio-storage'
import { mergeStudioCollections, parseStudioCollection } from '../../../../../packages/drape-studio/src/studio-collection'
import { parseLook } from '../../../../../packages/drape-studio/src/studio-state'
export function StudioWorkspace() {
  const frame = useRef<HTMLIFrameElement>(null)
  const [owner, setOwner] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [back, setBack] = useState('/explore')
  useEffect(() => {
    let active = true
    const supabase = createClient()
    void supabase.auth.getSession().then(({ data, error }) => {
      if (active) {
        setOwner(data.session?.user.id ?? null)
        const requested = new URLSearchParams(window.location.search).get('returnTo')
        setBack(
          requested && /^\/(?:account|explore|guide|vision)(?:[/?#]|$)/.test(requested) && !requested.includes('\\')
            ? requested
            : data.session?.user.user_metadata?.role === 'TAILOR'
              ? '/account/work'
              : data.session ? '/account/explore' : '/explore'
        )
        setError(error ? 'Your session could not be loaded. Please sign in again.' : '')
        setLoading(false)
      }
    })
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setOwner(session?.user.id ?? null)
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])
  useEffect(() => {
    if (!owner || loading) return
    const accountId = owner
    const key = studioStorageKey(accountId)
    const draftKey = studioDraftKey(accountId)
    const requestedOrder = new URLSearchParams(window.location.search).get('orderRevision')
    const orderId = requestedOrder && /^[0-9a-f-]{36}$/i.test(requestedOrder) ? requestedOrder : null
    const requestedReference = new URLSearchParams(window.location.search).get('orderReference')
    const referenceOrderId = !orderId && requestedReference && /^[0-9a-f-]{36}$/i.test(requestedReference) ? requestedReference : null
    const supabase = createClient()
    let cloudRevision: number | null = null
    let revisionDraftKey: string | null = null
    let orderInitialization: Promise<{ draft: ReturnType<typeof parseDraft>; orderVersion: number; notice: string }> | null = null
    let referenceInitialization: Promise<{ draft: ReturnType<typeof parseDraft>; sourceVersion: number; notice: string }> | null = null
    let initialization: Promise<{ looks: ReturnType<typeof parseSavedLooks>; draft: ReturnType<typeof parseDraft>; notice: string }> | null = null
    async function loadOrder() {
      if (!orderId) throw Error('This order link is invalid.')
      const { data, error } = await supabase.from('order_studio_design_versions')
        .select('version, design').eq('order_id', orderId)
        .order('version', { ascending: false }).limit(1).maybeSingle()
      if (error || !data) throw Error('The order design could not be opened. Return to the order and try again.')
      revisionDraftKey = `${draftKey}-order-${orderId}-v${data.version}`
      const saved = localStorage.getItem(revisionDraftKey)
      const currentDesign = parseLook(data.design)
      let draft = currentDesign
      let notice = ''
      if (saved) {
        try {
          draft = parseDraft(JSON.parse(saved)) ?? currentDesign
          if (draft === currentDesign) notice = 'The order draft on this device could not be read. The latest saved order version is open; your device copy was kept.'
        } catch {
          notice = 'The order draft on this device could not be read. The latest saved order version is open; your device copy was kept.'
        }
      }
      return { draft, orderVersion: data.version as number, notice }
    }
    async function loadOrderReference() {
      if (!referenceOrderId) throw Error('This order link is invalid.')
      const { data, error } = await supabase.from('order_studio_design_versions')
        .select('version, design').eq('order_id', referenceOrderId)
        .order('version', { ascending: false }).limit(1).maybeSingle()
      if (error || !data) throw Error('The customer design could not be opened. Return to the order and try again.')
      revisionDraftKey = `${draftKey}-tailor-copy-${referenceOrderId}-v${data.version}`
      const saved = localStorage.getItem(revisionDraftKey)
      const currentDesign = parseLook(data.design)
      let draft = currentDesign
      let notice = 'Working copy of the customer design. The order stays unchanged until you send a style plan for approval.'
      if (saved) {
        try {
          draft = parseDraft(JSON.parse(saved)) ?? currentDesign
        } catch {
          notice = 'Your working copy could not be read. The latest customer design is open; your device copy was kept.'
        }
      }
      return { draft, sourceVersion: data.version as number, notice }
    }
    async function loadCollection() {
      const saved = localStorage.getItem(key)
      const draft = localStorage.getItem(draftKey)
      if (saved && saved.length > MAX_STUDIO_BYTES) throw Error('Saved designs are too large to open.')
      const deviceLooks = saved ? parseSavedLooks(JSON.parse(saved)) : []
      const localDraft = draft ? parseDraft(JSON.parse(draft)) : null
      try {
        const { data, error } = await supabase.functions.invoke('studio-collection-action', { body: { action: 'load' } })
        if (error || !data?.ok) throw Error('Cloud load failed')
        const cloud = parseStudioCollection(data)
        const merged = mergeStudioCollections(cloud.looks, deviceLooks)
        if (merged.omittedCopies) return { looks: deviceLooks, draft: localDraft, notice: 'Your device has unsynced looks and the account collection is full. Export a copy before changing devices.' }
        const looks = parseSavedLooks(merged.looks)
        cloudRevision = cloud.revision
        localStorage.setItem(key, JSON.stringify(looks))
        return {
          looks,
          draft: localDraft,
          notice: cloud.revision > 0 && merged.recoveredCopies > 0
            ? 'Device-only looks were kept as separate copies. Save one to sync the collection.'
            : '',
        }
      } catch {
        return { looks: deviceLooks, draft: localDraft, notice: 'Account sync is unavailable. Your designs remain on this device.' }
      }
    }
    async function receive(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow) return
      const m = event.data as Record<string, unknown>
      if (!m || m.channel !== 'drape-studio') return
      function reply(value: object) {
        frame.current?.contentWindow?.postMessage({ channel: 'drape-studio', ...value }, '*')
      }
      try {
        if (m.type === 'ready') {
          initialization ??= loadCollection()
          const current = await initialization
          const revision = orderId ? await (orderInitialization ??= loadOrder()) : null
          const reference = referenceOrderId ? await (referenceInitialization ??= loadOrderReference()) : null
          reply({ type: 'init', ...current, ...revision, ...reference, notice: [current.notice, revision?.notice, reference?.notice].filter(Boolean).join(' '), mode: new URLSearchParams(window.location.search).get('mode'), canAttach: !revision && !reference && /^\/account\/brief\/[0-9a-f-]{36}(?:\?|$)/i.test(back) })
          return
        }
        if (m.type === 'save' && typeof m.id === 'string') {
          if (initialization) await initialization
          const looks = parseSavedLooks(m.looks)
          localStorage.setItem(key, JSON.stringify(looks))
          let warning = ''
          if (cloudRevision === null) {
            warning = 'Saved on this device. Account sync is unavailable; download a design copy before changing devices.'
          } else {
            try {
              const { data, error } = await supabase.functions.invoke('studio-collection-action', {
                body: { action: 'save', expectedRevision: cloudRevision, looks },
              })
              if (error || !data?.ok) throw Error('Cloud save failed')
              cloudRevision = parseStudioCollection({ revision: data.revision, looks }).revision
            } catch {
              cloudRevision = null
          warning = 'Saved on this device. Account sync did not finish; reopen Sketch Room to compare copies.'
            }
          }
          reply({ type: 'result', id: m.id, warning })
          return
        }
        if (m.type === 'draft' && typeof m.id === 'string') {
          if (orderId) await (orderInitialization ??= loadOrder())
          if (referenceOrderId) await (referenceInitialization ??= loadOrderReference())
          const next = parseDraft(m.draft)
          if (!next) throw Error('The draft is empty.')
          localStorage.setItem(revisionDraftKey ?? draftKey, JSON.stringify(next))
          reply({ type: 'result', id: m.id })
          return
        }
        if (m.type === 'revise-order' && typeof m.id === 'string') {
          const revision = await (orderInitialization ??= loadOrder())
          const design = parseLook(m.design)
          const note = typeof m.note === 'string' ? m.note.trim() : ''
          if (note.length < 5 || note.length > 500 || typeof m.image !== 'string') throw Error('Add a short revision note and try again.')
          const { data, error } = await supabase.functions.invoke('studio-order-action', {
            body: { action: 'revise', orderId, expectedVersion: revision.orderVersion, design, sheetImage: m.image, note },
          })
          if (error || !data?.ok) {
            const failure = error && 'context' in error ? await (error.context as Response).json().catch(() => null) : null
            throw Error(failure?.error ?? data?.error ?? 'The revision could not be saved. Try again.')
          }
          if (revisionDraftKey) localStorage.removeItem(revisionDraftKey)
          reply({ type: 'result', id: m.id })
          window.setTimeout(() => window.location.assign(back), 100)
          return
        }
        if (m.type === 'propose-style-plan' && typeof m.id === 'string') {
          const reference = await (referenceInitialization ??= loadOrderReference())
          const note = typeof m.note === 'string' ? m.note.trim() : ''
          const image = typeof m.image === 'string' ? m.image : ''
          if (note.length < 10 || note.length > 500 || image.length > 9_000_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) {
            throw Error('Add a short style plan and try again with a smaller design sheet.')
          }
          const blob = await (await fetch(image)).blob()
          if (blob.size > 10_000_000) throw Error('The design sheet is too large to send.')
          const path = `progress/${referenceOrderId}/style-alignment-${crypto.randomUUID()}.png`
          const storage = supabase.storage.from('order-photos')
          const uploaded = await storage.upload(path, blob, { contentType: 'image/png', cacheControl: '31536000', upsert: false })
          if (uploaded.error) throw Error('The design sheet could not upload. Try again.')
          const photoUrl = storage.getPublicUrl(path).data.publicUrl
          const { data, error } = await supabase.functions.invoke('tailor-order-action', {
            body: { action: 'request-style-alignment', orderId: referenceOrderId, note, photoUrl, expectedStudioVersion: reference.sourceVersion },
          })
          if (error || !data?.ok) {
            const failure = error && 'context' in error ? await (error.context as Response).json().catch(() => null) : null
            throw Error(failure?.error ?? data?.error ?? 'The style plan could not be sent. Try again.')
          }
          reply({ type: 'result', id: m.id })
          window.setTimeout(() => window.location.assign(back), 100)
          return
        }
        if (m.type === 'attach') {
          const handoff = parseStudioBriefHandoff(m)
          sessionStorage.setItem(`drape-studio-brief-${accountId}`, JSON.stringify(handoff))
          const target = new URL(back, window.location.origin)
          target.searchParams.set('studioAttach', '1')
          window.location.assign(target.toString())
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Device storage is unavailable.'
        if (typeof m.id === 'string') reply({ type: 'result', id: m.id, error: message })
        else setError(message)
      }
    }
    const listener = (event: MessageEvent) => { void receive(event) }
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [owner, back, loading])
  return (
    <main
      id="main-content"
      style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: '#faf8f2' }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 24,
          padding: '12px 20px',
          borderBottom: '1px solid #dddcd2',
        }}
      >
        <Link href={back as Route}>← Back to Drapeon</Link>
      </header>
      {loading ? (
        <p style={{ padding: 24 }}>Opening Sketch Room…</p>
      ) : error ? (
        <p role="alert" style={{ padding: 24 }}>
          {error}
        </p>
      ) : !owner ? (
        <StudioGuestPreview returnTo={back}/>
      ) : (
        <iframe
          id="studio-editor"
          key={owner}
          ref={frame}
          title="Drapeon Sketch Room · sketch pad"
          src="/studio/editor"
          sandbox="allow-scripts allow-downloads allow-modals"
          style={{ width: '100%', flex: 1, border: 0 }}
        />
      )}
    </main>
  )
}

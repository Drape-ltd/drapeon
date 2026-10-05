import { EducationHelp } from '@/features/user-education/EducationHelp'
import { useRef, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { WebView } from 'react-native-webview'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Directory, File, Paths } from 'expo-file-system'
import { Feather } from '@expo/vector-icons'
import { Colors, Spacing } from '@/constants/theme'
import { useAuth, useUserRole } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { goBackOrReturnTo } from '@/lib/navigation'
import { useContextualBackHandler } from '@/lib/use-contextual-back'
import { Button } from '@/components/ui'
import { uploadPublicStorageImage } from '@/lib/storage-upload'
import { STUDIO_DEV_ENABLED } from './availability'
import { loadStudioDraft, loadStudioLooks, saveStudioDraft, saveStudioLooks } from './studio-storage'
import { exportStudioFile } from './studio-export'
import { parseStudioBriefHandoff } from '../../../../packages/drape-studio/src/studio-storage'
import { parseDraft } from '../../../../packages/drape-studio/src/studio-storage'
import { parseLook } from '../../../../packages/drape-studio/src/studio-state'
import { mergeStudioCollections, parseStudioCollection } from '../../../../packages/drape-studio/src/studio-collection'
// Generated from the same editor as web; contains no auth credentials.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const document: { html: string } = require('../../assets/studio/studio-document.json')
export function StudioScreen() {
  const { width: screenWidth } = useWindowDimensions()
  const { user } = useAuth(),
    router = useRouter(),
    navigation = useNavigation(),
    params = useLocalSearchParams<{ returnTo?: string; mode?: string; orderRevision?: string; orderReference?: string }>()
  const web = useRef<WebView>(null)
  const queue = useRef(Promise.resolve())
  const cloudRevision = useRef<number | null>(null)
  const initialization = useRef<Promise<{ looks: ReturnType<typeof loadStudioLooks>; draft: ReturnType<typeof loadStudioDraft>; notice: string }> | null>(null)
  const orderInitialization = useRef<Promise<{ draft: ReturnType<typeof parseDraft>; orderVersion: number; notice: string }> | null>(null)
  const referenceInitialization = useRef<Promise<{ draft: ReturnType<typeof parseDraft>; sourceVersion: number; notice: string }> | null>(null)
  const revisionDraftKey = useRef<string | null>(null)
  const [error, setError] = useState(''),
    [epoch, setEpoch] = useState(0),
    [editorReady, setEditorReady] = useState(false)
  const role = useUserRole()
  const fallback = role === 'TAILOR' ? '/(tailor)' : '/(customer)'
  const back = () => goBackOrReturnTo(router, navigation, params.returnTo, fallback as never)
  useContextualBackHandler(back)
  const owner = user?.id
  const orderId = params.orderRevision && /^[0-9a-f-]{36}$/i.test(params.orderRevision) ? params.orderRevision : null
  const referenceOrderId = !orderId && params.orderReference && /^[0-9a-f-]{36}$/i.test(params.orderReference) ? params.orderReference : null
  async function loadOrder(accountId: string) {
    if (!orderId) throw Error('This order link is invalid.')
    const { data, error } = await supabase.from('order_studio_design_versions')
      .select('version, design').eq('order_id', orderId)
      .order('version', { ascending: false }).limit(1).maybeSingle()
    if (error || !data) throw Error('The order design could not be opened. Return to the order and try again.')
    revisionDraftKey.current = `drape-studio-order-draft-${accountId}-${orderId}-v${data.version}`
    const saved = await AsyncStorage.getItem(revisionDraftKey.current)
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
  async function loadOrderReference(accountId: string) {
    if (!referenceOrderId) throw Error('This order link is invalid.')
    const { data, error } = await supabase.from('order_studio_design_versions')
      .select('version, design').eq('order_id', referenceOrderId)
      .order('version', { ascending: false }).limit(1).maybeSingle()
    if (error || !data) throw Error('The customer design could not be opened. Return to the order and try again.')
    revisionDraftKey.current = `drape-studio-tailor-copy-${accountId}-${referenceOrderId}-v${data.version}`
    const saved = await AsyncStorage.getItem(revisionDraftKey.current)
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
  async function loadCollection(accountId: string) {
    const deviceLooks = loadStudioLooks(accountId)
    const draft = loadStudioDraft(accountId)
    try {
      const { data, error } = await supabase.functions.invoke('studio-collection-action', { body: { action: 'load' } })
      if (error || !data?.ok) return { looks: deviceLooks, draft, notice: 'Account sync is unavailable. Your designs remain on this device.' }
      const cloud = parseStudioCollection(data)
      const merged = mergeStudioCollections(cloud.looks, deviceLooks)
      if (merged.omittedCopies) return { looks: deviceLooks, draft, notice: 'Your device has unsynced looks and the account collection is full. Export a copy before changing devices.' }
      saveStudioLooks(accountId, merged.looks)
      cloudRevision.current = cloud.revision
      return {
        looks: merged.looks,
        draft,
        notice: cloud.revision > 0 && merged.recoveredCopies > 0
          ? 'Device-only looks were kept as separate copies. Save one to sync the collection.'
          : '',
      }
    } catch {
      return { looks: deviceLooks, draft, notice: 'Account sync is unavailable. Your designs remain on this device.' }
    }
  }
  function reply(value: object) {
    web.current?.injectJavaScript(
      `window.drapeStudioReceive?.(${JSON.stringify({ channel: 'drape-studio', ...value })});true;`
    )
  }
  async function receive(raw: string) {
    if (!owner || raw.length > 25_000_000) return
    let id = ''
    try {
      const m = JSON.parse(raw) as Record<string, unknown>
      if (!m || m.channel !== 'drape-studio') return
      if (m.type === 'ready') {
        initialization.current ??= loadCollection(owner)
        const current = await initialization.current
        const revision = orderId ? await (orderInitialization.current ??= loadOrder(owner)) : null
        const reference = referenceOrderId ? await (referenceInitialization.current ??= loadOrderReference(owner)) : null
        reply({ type: 'init', ...current, ...revision, ...reference, notice: [current.notice, revision?.notice, reference?.notice].filter(Boolean).join(' '), mode: params.mode, canAttach: !revision && !reference && /^\/(?:\(customer\)\/)?brief\/[0-9a-f-]{36}(?:\?|$)/i.test(params.returnTo ?? '') })
        setEditorReady(true)
        return
      }
      if (m.type === 'attach') {
        const handoff = parseStudioBriefHandoff(m)
        const match = handoff.image.match(/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/)
        if (!match) throw Error('The design sheet could not be read.')
        const directory = new Directory(Paths.document, 'studio-brief-references')
        directory.create({ intermediates: true, idempotent: true })
        const file = new File(directory, `studio-${Date.now()}.png`)
        file.write(match[1], { encoding: 'base64' })
        await AsyncStorage.setItem(`drape-studio-brief-${owner}`, JSON.stringify({ uri: file.uri, notes: handoff.notes, name: handoff.name, design: handoff.design }))
        back()
        return
      }
      if (typeof m.id !== 'string' || !/^\d{1,10}$/.test(m.id)) return
      id = m.id
      const operation = queue.current.then(async () => {
        let warning = ''
        if (m.type === 'save') {
          if (initialization.current) await initialization.current
          const looks = saveStudioLooks(owner, m.looks)
          if (cloudRevision.current === null) {
            warning = 'Saved on this device. Account sync is unavailable; export a design copy before changing devices.'
          } else {
            try {
              const { data, error } = await supabase.functions.invoke('studio-collection-action', {
                body: { action: 'save', expectedRevision: cloudRevision.current, looks },
              })
              if (error || !data?.ok) throw Error('Cloud save failed')
              cloudRevision.current = parseStudioCollection({ revision: data.revision, looks }).revision
            } catch {
              cloudRevision.current = null
              warning = 'Saved on this device. Account sync did not finish; reopen Sketch Room to compare copies.'
            }
          }
        } else if (m.type === 'draft') {
          if (orderId || referenceOrderId) {
            if (orderId) await (orderInitialization.current ??= loadOrder(owner))
            else await (referenceInitialization.current ??= loadOrderReference(owner))
            const draft = parseDraft(m.draft)
            if (!draft || !revisionDraftKey.current) throw Error('The order draft could not be saved.')
            await AsyncStorage.setItem(revisionDraftKey.current, JSON.stringify(draft))
          } else saveStudioDraft(owner, m.draft)
        } else if (m.type === 'revise-order') {
          const revision = await (orderInitialization.current ??= loadOrder(owner))
          const design = parseLook(m.design)
          const note = typeof m.note === 'string' ? m.note.trim() : ''
          if (!orderId || note.length < 5 || note.length > 500 || typeof m.image !== 'string') throw Error('Add a short revision note and try again.')
          const { data, error } = await supabase.functions.invoke('studio-order-action', {
            body: { action: 'revise', orderId, expectedVersion: revision.orderVersion, design, sheetImage: m.image, note },
          })
          if (error || !data?.ok) {
            const failure = error && 'context' in error ? await (error.context as Response).json().catch(() => null) : null
            throw Error(failure?.error ?? data?.error ?? 'The revision could not be saved. Try again.')
          }
          if (revisionDraftKey.current) await AsyncStorage.removeItem(revisionDraftKey.current)
          reply({ type: 'result', id })
          setTimeout(back, 100)
          return
        } else if (m.type === 'propose-style-plan') {
          const reference = await (referenceInitialization.current ??= loadOrderReference(owner))
          const note = typeof m.note === 'string' ? m.note.trim() : ''
          const image = typeof m.image === 'string' ? m.image : ''
          const match = image.length <= 9_000_000 ? image.match(/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/) : null
          if (!referenceOrderId || note.length < 10 || note.length > 500 || !match) throw Error('Add a short style plan and try again with a smaller design sheet.')
          const directory = new Directory(Paths.cache, 'studio-style-plans')
          directory.create({ intermediates: true, idempotent: true })
          const file = new File(directory, `studio-${Date.now()}.png`)
          file.write(match[1], { encoding: 'base64' })
          let photoUrl: string
          try {
            photoUrl = await uploadPublicStorageImage({
              bucket: 'order-photos',
              path: `progress/${referenceOrderId}/style-alignment-${Date.now()}-${Math.random().toString(36).slice(2)}.png`,
              uri: file.uri,
              contentType: 'image/png',
              maxBytes: 10_000_000,
              purpose: 'ORDER_REFERENCE',
            })
          } finally {
            try { file.delete() } catch { /* Cache cleanup is best effort. */ }
          }
          const { data, error } = await supabase.functions.invoke('tailor-order-action', {
            body: { action: 'request-style-alignment', orderId: referenceOrderId, note, photoUrl, expectedStudioVersion: reference.sourceVersion },
          })
          if (error || !data?.ok) {
            const failure = error && 'context' in error ? await (error.context as Response).json().catch(() => null) : null
            throw Error(failure?.error ?? data?.error ?? 'The style plan could not be sent. Try again.')
          }
          reply({ type: 'result', id })
          setTimeout(back, 100)
          return
        }
        else if (m.type === 'export') await exportStudioFile(m)
        else throw Error('Unsupported Sketch Room action.')
        reply({ type: 'result', id, warning })
      })
      queue.current = operation.catch(() => {})
      await operation
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Sketch Room could not finish that action.'
      if (id) reply({ type: 'result', id, error: message })
      else setError(message)
    }
  }
  return (
    <SafeAreaView style={styles.safe}>
      <EducationHelp context="studio" compact hideWhenSeen />
        <View style={styles.header}>
        <TouchableOpacity
          onPress={back}
          accessibilityRole="button"
          accessibilityLabel="Back from Sketch Room"
          style={styles.back}
        >
          <Feather name="arrow-left" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <View>
          <Text style={styles.title}>Sketch Room</Text>
          {screenWidth > 620 ? <Text style={styles.caption}>Local draft recovery · named looks sync when connected</Text> : null}
        </View>
        {screenWidth <= 620 && STUDIO_DEV_ENABLED && owner ? (
          <View style={styles.headerActions}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Open sketch tools"
              disabled={!editorReady}
              onPress={() => web.current?.injectJavaScript("document.getElementById('openTools')?.click();true;")}
              style={styles.headerSecondary}
            >
              <Text style={styles.headerSecondaryText}>Tools</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Undo last sketch change"
              disabled={!editorReady}
              onPress={() => web.current?.injectJavaScript("document.getElementById('undo')?.click();true;")}
              style={styles.headerIcon}
            >
              <Feather name="corner-up-left" size={17} color={Colors.ink} />
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Redo last sketch change"
              disabled={!editorReady}
              onPress={() => web.current?.injectJavaScript("document.getElementById('redo')?.click();true;")}
              style={styles.headerIcon}
            >
              <Feather name="corner-up-right" size={17} color={Colors.ink} />
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Review design"
              disabled={!editorReady}
              onPress={() => web.current?.injectJavaScript("document.getElementById('review')?.click();true;")}
              style={[styles.headerPrimary, !editorReady && styles.headerDisabled]}
            >
              <Text style={styles.headerPrimaryText}>Review</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
      {!STUDIO_DEV_ENABLED || !owner ? (
        <View style={styles.notice}>
          <Text>Sketch Room is available to signed-in accounts in Drapeon Dev.</Text>
          <Button label="Go back" onPress={back} />
        </View>
      ) : error ? (
        <View style={styles.notice}>
          <Text>{error}</Text>
          <Button
            label="Retry Sketch Room"
            onPress={() => {
              setError('')
              setEpoch((n) => n + 1)
            }}
          />
        </View>
      ) : (
        <WebView
          key={`${owner}:${epoch}`}
          ref={web}
          source={document}
          style={styles.web}
          originWhitelist={['*']}
          onShouldStartLoadWithRequest={(r) => r.url === 'about:blank'}
          onMessage={(e) => void receive(e.nativeEvent.data)}
          onError={() =>
            setError('Sketch Room could not load. Your saved drafts are still on this device.')
          }
          onContentProcessDidTerminate={() =>
            setError('Sketch Room needs to reload. Reopen your last saved draft.')
          }
          onRenderProcessGone={() => {
            setError('Sketch Room needs to reload. Reopen your last saved draft.')
            return true
          }}
          javaScriptEnabled
          domStorageEnabled={false}
          setSupportMultipleWindows={false}
          allowFileAccess={false}
        />
      )}
    </SafeAreaView>
  )
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 1,
    gap: 4,
  },
  back: { width: 36, height: 38, justifyContent: 'center' },
  title: { fontSize: 16, color: Colors.ink, fontWeight: '600' },
  caption: { fontSize: 11, color: Colors.midGrey },
  headerActions: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerSecondary: { minHeight: 34, paddingHorizontal: 8, justifyContent: 'center' },
  headerSecondaryText: { color: Colors.ink, fontSize: 11, fontWeight: '600' },
  headerIcon: { width: 32, height: 34, justifyContent: 'center', alignItems: 'center' },
  headerPrimary: { minHeight: 34, paddingHorizontal: 11, justifyContent: 'center', borderRadius: 17, backgroundColor: Colors.needleGreen },
  headerPrimaryText: { color: Colors.white, fontSize: 11, fontWeight: '600' },
  headerDisabled: { opacity: 0.5 },
  notice: { padding: 24, gap: 20 },
  web: { flex: 1, backgroundColor: Colors.bone },
})

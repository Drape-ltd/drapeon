/**
 * Tailor CRM — client list + diary
 * "Online" tab: platform clients who've placed orders
 * "Diary" tab: offline clients measured in-person (Client Passport system)
 */
import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator, RefreshControl,
  ActionSheetIOS, Alert, Share, Platform,
} from 'react-native'
import { useRouter, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as FileSystem from 'expo-file-system/legacy'
import { buildDiaryCsv, type DiaryExportRow } from '@drape/shared'
import { invokeFunction, supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { shareTailorProfile, inviteCustomerFromTailor, sharePassportInvite } from '@/lib/invite'
import { appendToHistory } from '@/lib/navigation'
import { AvatarImage } from '@/components/ui'
import { useDrapeCapsuleNavScroll } from '@/components/ui/DrapeCapsuleNav'
import { Colors, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'

const CLIENT_TAB_KEY = 'drape:clients:last_tab'

type Tab = 'customers' | 'diary'
type CustomerFilter = 'all' | 'recent' | 'repeat'
type CustomerSort = 'recent' | 'name' | 'orders'
type DiaryFilter = 'all' | 'ready' | 'sent' | 'claimed'

type ClientRow = {
  customerId: string
  displayName: string
  avatarUrl: string | null
  totalOrders: number
  lastOrderDate: string
  lastGarmentType: string
}

type DiaryRow = {
  id: string
  passportId: string
  fullName: string
  measuredAt: string | null
  inviteStatus: string
  // Measurements — used to determine whether an entry is share-ready
  chest: number | null
  shoulder: number | null
  sleeve: number | null
  waist: number | null
  hip: number | null
  neck: number | null
  trouserLength: number | null
  inseam: number | null
  thigh: number | null
  ankle: number | null
  bicep: number | null
  wrist: number | null
  backLength: number | null
  underBust: number | null
  eventType: string | null
  unit: string
}

type CustomerProfileJoinRow = {
  display_name: string | null
  avatar_url: string | null
}

type ClientOrderQueryRow = {
  customer_id: string | null
  garment_type: string | null
  created_at: string
  customer_profiles: CustomerProfileJoinRow | CustomerProfileJoinRow[] | null
}

type DiaryEntryQueryRow = {
  id: string
  passport_id: string
  full_name: string
  measured_at: string | null
  invite_status: string
  chest: number | null
  shoulder: number | null
  sleeve: number | null
  waist: number | null
  hip: number | null
  neck: number | null
  trouser_length: number | null
  inseam: number | null
  thigh: number | null
  ankle: number | null
  bicep: number | null
  wrist: number | null
  back_length: number | null
  under_bust: number | null
  event_type: string | null
  measurement_unit: string | null
}

type TailorProfileQueryRow = {
  id: string
  display_name: string | null
  is_live: boolean | null
}

function firstJoinedRow<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

// An entry is share-ready when it has a name and at least one measurement.
const DIARY_GROUPS = [
  { label: 'Ready to invite', match: (entry: DiaryRow) => entry.inviteStatus === 'NOT_INVITED' && isEntryShareReady(entry) },
  { label: 'Needs measurements', match: (entry: DiaryRow) => entry.inviteStatus === 'NOT_INVITED' && !isEntryShareReady(entry) },
  { label: 'Waiting on them', match: (entry: DiaryRow) => ['LINK_COPIED', 'LINK_SHARED', 'INVITE_SENT'].includes(entry.inviteStatus) },
  { label: 'Claimed', match: (entry: DiaryRow) => entry.inviteStatus === 'CLAIMED' },
] as const

function isEntryShareReady(item: DiaryRow): boolean {
  if (!item.fullName.trim()) return false
  return [item.chest, item.shoulder, item.sleeve, item.waist, item.hip, item.neck,
    item.trouserLength, item.inseam, item.thigh, item.ankle, item.bicep, item.wrist,
    item.backLength, item.underBust]
    .some((v) => v !== null)
}

export default function TailorClientsScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ tab?: string; filter?: string }>()
  const routeTab = params.tab === 'diary' ? 'diary' : null
  const routeFilter = params.filter === 'claimed' ? 'claimed' : null
  const capsuleNavScroll = useDrapeCapsuleNavScroll()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const userId = user?.id
  const [tab, setTab] = useState<Tab>(routeTab ?? 'customers')
  const [exportingDiary, setExportingDiary] = useState(false)

  // Online clients
  const [clients, setClients] = useState<ClientRow[]>([])
  const [filtered, setFiltered] = useState<ClientRow[]>([])
  const [search, setSearch] = useState('')
  const [customerFilter, setCustomerFilter] = useState<CustomerFilter>('all')
  const [customerSort, setCustomerSort] = useState<CustomerSort>('recent')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [fetchError, setFetchError] = useState(false)
  const [tailorProfile, setTailorProfile] = useState<{ id: string; displayName: string; isLive: boolean } | null>(null)

  // Diary
  const [diary, setDiary] = useState<DiaryRow[]>([])
  const [diarySearch, setDiarySearch] = useState('')
  const [diaryFilter, setDiaryFilter] = useState<DiaryFilter>(routeFilter ?? 'all')
  const [diaryLoading, setDiaryLoading] = useState(false)
  const [diaryFetchError, setDiaryFetchError] = useState(false)
  const [sharingDiaryId, setSharingDiaryId] = useState<string | null>(null)

  useEffect(() => {
    if (routeTab === 'diary') {
      setTab('diary')
      void AsyncStorage.setItem(CLIENT_TAB_KEY, 'diary').catch(() => {})
      if (routeFilter === 'claimed') setDiaryFilter('claimed')
      return
    }
    let active = true
    AsyncStorage.getItem(CLIENT_TAB_KEY)
      .then((value) => {
        if (active && (value === 'customers' || value === 'diary')) setTab(value)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [routeTab, routeFilter])

  function selectTab(next: Tab) {
    setTab(next)
    void AsyncStorage.setItem(CLIENT_TAB_KEY, next).catch(() => {})
  }

  const fetchClients = useCallback(async () => {
    if (!userId) {
      setClients([])
      setFiltered([])
      return
    }
    setFetchError(false)
    try {
      const rows: ClientOrderQueryRow[] = []
      for (let start = 0; ; start += 500) {
        const { data, error } = await supabase
          .from('orders')
          .select(`
          customer_id, garment_type, created_at,
          customer_profiles!customer_id(display_name, avatar_url)
        `)
          .eq('tailor_id', userId)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(start, start + 499)
        if (error) throw error
        rows.push(...((data ?? []) as ClientOrderQueryRow[]))
        if (!data || data.length < 500) break
      }
      if (rows.length === 0) {
        setClients([])
        setFiltered([])
        return
      }

      // Aggregate per customer
      const map = new Map<string, ClientRow>()
      for (const row of rows) {
        if (!row.customer_id) continue
        const customerProfile = firstJoinedRow(row.customer_profiles)
        const existing = map.get(row.customer_id)
        if (existing) {
          existing.totalOrders += 1
        } else {
          map.set(row.customer_id, {
            customerId: row.customer_id,
            displayName: customerProfile?.display_name ?? 'Customer',
            avatarUrl: customerProfile?.avatar_url ?? null,
            totalOrders: 1,
            lastOrderDate: row.created_at,
            lastGarmentType: row.garment_type ?? 'Order',
          })
        }
      }

      const list = Array.from(map.values()).sort((a, b) =>
        new Date(b.lastOrderDate).getTime() - new Date(a.lastOrderDate).getTime()
      )
      setClients(list)
      applySearch(list, search)
    } catch {
      setFetchError(true)
      setClients([])
      setFiltered([])
    }
  }, [search, userId])

  function applySearch(list: ClientRow[], q: string) {
    if (!q.trim()) {
      setFiltered(list)
    } else {
      const lower = q.toLowerCase()
      setFiltered(list.filter((c) => c.displayName.toLowerCase().includes(lower)))
    }
  }

  const fetchDiary = useCallback(async () => {
    if (!userId) return
    setDiaryFetchError(false)
    try {
      const rows: DiaryEntryQueryRow[] = []
      for (let start = 0; ; start += 500) {
        const { data, error } = await supabase
          .from('diary_entries')
          .select('id, passport_id, full_name, measured_at, invite_status, chest, shoulder, sleeve, waist, hip, neck, trouser_length, inseam, thigh, ankle, bicep, wrist, back_length, under_bust, event_type, measurement_unit')
          .eq('tailor_id', userId)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(start, start + 499)
        if (error) throw error
        rows.push(...((data ?? []) as DiaryEntryQueryRow[]))
        if (!data || data.length < 500) break
      }
      setDiary(rows.map((r) => ({
        id: r.id,
        passportId: r.passport_id,
        fullName: r.full_name,
        measuredAt: r.measured_at,
        inviteStatus: r.invite_status,
        chest: r.chest,
        shoulder: r.shoulder,
        sleeve: r.sleeve,
        waist: r.waist,
        hip: r.hip,
        neck: r.neck,
        trouserLength: r.trouser_length,
        inseam: r.inseam,
        thigh: r.thigh,
        ankle: r.ankle,
        bicep: r.bicep,
        wrist: r.wrist,
        backLength: r.back_length,
        underBust: r.under_bust,
        eventType: r.event_type,
        unit: r.measurement_unit ?? 'in',
      })))
    } catch {
      setDiaryFetchError(true)
      setDiary([])
    }
  }, [userId])

  const loadTailorProfile = useCallback(async () => {
    if (!userId) {
      setTailorProfile(null)
      return
    }

    const { data, error } = await supabase
      .from('tailor_profiles')
      .select('id, display_name, is_live')
      .eq('user_id', userId)
      .maybeSingle()

    if (error || !data) {
      setTailorProfile(null)
      return
    }

    const profile = data as TailorProfileQueryRow
    setTailorProfile({
      id: profile.id,
      displayName: profile.display_name ?? '',
      isLive: profile.is_live ?? false,
    })
  }, [userId])

  useFocusEffect(useCallback(() => {
    setLoading(true)
    fetchClients().finally(() => setLoading(false))
    setDiaryLoading(true)
    fetchDiary().finally(() => setDiaryLoading(false))
    void loadTailorProfile()
  }, [fetchClients, fetchDiary, loadTailorProfile]))

  const onSearch = useCallback((text: string) => {
    setSearch(text)
    applySearch(clients, text)
  }, [clients])

  async function onRefresh() {
    setRefreshing(true)
    await Promise.allSettled([fetchClients(), fetchDiary()])
    setRefreshing(false)
  }

  async function exportDiaryCsv() {
    if (!userId || exportingDiary) return
    setExportingDiary(true)
    try {
      const fields = 'full_name,gender,measurement_unit,chest,shoulder,sleeve,waist,hip,neck,trouser_length,thigh,inseam,ankle,bicep,wrist,back_length,under_bust,fabric_preference,style_preference,event_type,client_notes,special_fitting_notes,measured_at,measured_location,invite_status'
      const rows: DiaryExportRow[] = []
      for (let start = 0; ; start += 500) {
        const { data, error } = await supabase.from('diary_entries').select(fields).eq('tailor_id', userId).order('id', { ascending: true }).range(start, start + 499)
        if (error) throw error
        const batch = (data ?? []) as DiaryExportRow[]
        rows.push(...batch)
        if (batch.length < 500) break
      }
      const directory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory
      if (!directory) throw new Error('No export folder is available on this device.')
      const fileUri = `${directory}drapeon-client-diary-${Date.now()}.csv`
      await FileSystem.writeAsStringAsync(fileUri, buildDiaryCsv(rows), { encoding: FileSystem.EncodingType.UTF8 })
      if (Platform.OS === 'android') {
        const folder = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync()
        if (!folder.granted) return
        const destination = await FileSystem.StorageAccessFramework.createFileAsync(folder.directoryUri, `drapeon-client-diary-${Date.now()}.csv`, 'text/csv')
        const encoded = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 })
        await FileSystem.writeAsStringAsync(destination, encoded, { encoding: FileSystem.EncodingType.Base64 })
        Alert.alert('Diary downloaded', `${rows.length} private fitting records saved. Keep this file secure.`)
      } else {
        await Share.share({ url: fileUri, message: `Drapeon private client diary export (${rows.length} records). Keep this file secure.` })
      }
    } catch (error) {
      Alert.alert('Could not export diary', error instanceof Error ? error.message : 'Please try again.')
    } finally { setExportingDiary(false) }
  }

  async function exportDiaryRecordCsv(item: DiaryRow) {
    if (!userId) return
    try {
      const fields = 'full_name,gender,measurement_unit,chest,shoulder,sleeve,waist,hip,neck,trouser_length,thigh,inseam,ankle,bicep,wrist,back_length,under_bust,fabric_preference,style_preference,event_type,client_notes,special_fitting_notes,measured_at,measured_location,invite_status'
      const { data, error } = await supabase.from('diary_entries').select(fields).eq('id', item.id).eq('tailor_id', userId).maybeSingle()
      if (error) throw error
      if (!data) throw new Error('This fitting record could not be found. Refresh your diary and try again.')
      const row = data as DiaryExportRow
      const safeName = item.fullName.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '') || 'client'
      const filename = `drapeon-fitting-record-${safeName}-${new Date().toISOString().slice(0, 10)}.csv`
      const directory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory
      if (!directory) throw new Error('No export folder is available on this device.')
      const fileUri = `${directory}${filename}`
      await FileSystem.writeAsStringAsync(fileUri, buildDiaryCsv([row]), { encoding: FileSystem.EncodingType.UTF8 })
      if (Platform.OS === 'android') {
        const folder = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync()
        if (!folder.granted) return
        const destination = await FileSystem.StorageAccessFramework.createFileAsync(folder.directoryUri, filename, 'text/csv')
        const encoded = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 })
        await FileSystem.writeAsStringAsync(destination, encoded, { encoding: FileSystem.EncodingType.Base64 })
      } else {
        await Share.share({ url: fileUri, message: `Private fitting record for ${item.fullName}. Keep this file secure.` })
      }
      Alert.alert('Record ready', `${item.fullName}'s private fitting record is ready. Keep this file secure.`)
    } catch (error) {
      Alert.alert('Could not export record', error instanceof Error ? error.message : 'Please try again.')
    }
  }

  async function markInviteLinkStatus(entryId: string, status: 'LINK_COPIED' | 'LINK_SHARED') {
    const { error } = await invokeFunction('diary-entry-action', {
      body: { action: status === 'LINK_COPIED' ? 'mark-invite-copied' : 'mark-invite-shared', entryId },
    })
    if (error) throw error

    // The share sheet confirms a copy or handoff, not delivery to the client.
    setDiary((prev) =>
      prev.map((d) => d.id === entryId ? { ...d, inviteStatus: status } : d)
    )
  }

  async function markInviteLinkStatusWithFeedback(entryId: string, status: 'LINK_COPIED' | 'LINK_SHARED') {
    try {
      await markInviteLinkStatus(entryId, status)
    } catch {
      Alert.alert('Diary status not updated', 'The link was copied or shared, but we could not record that outcome. Please retry from this diary entry.')
    }
  }

  function inviteLinkStatusFromShareResult(result: { action: string; activityType?: string | null }): 'LINK_COPIED' | 'LINK_SHARED' | null {
    if (result.action === Share.dismissedAction) return null
    return result.activityType?.toLowerCase().includes('copy') ? 'LINK_COPIED' : 'LINK_SHARED'
  }

  async function shareInviteLink(link: string, entryId: string) {
    try {
      const result = await Share.share({ message: link })
      const status = inviteLinkStatusFromShareResult(result)
      if (status) await markInviteLinkStatusWithFeedback(entryId, status)
    } catch {
      Alert.alert('Unable to share invite', 'Sharing is unavailable right now. Retry from this diary entry in a moment, or come back later and try again.')
    }
  }

  async function sharePassportInviteWithFeedback(item: DiaryRow, tailorName: string) {
    try {
      const outcome = await sharePassportInvite(item.passportId, item.fullName, tailorName)
      const status = outcome === 'copied' ? 'LINK_COPIED' : outcome === 'shared' ? 'LINK_SHARED' : null
      if (status) await markInviteLinkStatusWithFeedback(item.id, status)
    } catch {
      Alert.alert('Unable to share invite', 'Sharing is unavailable right now. Retry from this diary entry in a moment, or come back later and try again.')
    }
  }

  async function handleShareCard(item: DiaryRow) {
    if (sharingDiaryId) return
    if (!isEntryShareReady(item)) {
      Alert.alert('', 'Complete customer details to generate an invite.', [{ text: 'OK' }])
      return
    }
    const link = `https://drapeon.co/passport/claim/${item.passportId}`
    const tailorName = tailorProfile?.displayName ?? ''
    setSharingDiaryId(item.id)

    try {
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          { options: ['Cancel', 'Share invite link', 'Share…'], cancelButtonIndex: 0 },
          async (idx) => {
            if (idx === 1) {
              await shareInviteLink(link, item.id)
            } else if (idx === 2) {
              await sharePassportInviteWithFeedback(item, tailorName)
            }
            setSharingDiaryId(null)
          }
        )
        return
      }

      Alert.alert(
        'Share invite',
        undefined,
        [
          {
            text: 'Share invite link',
            onPress: async () => {
              await shareInviteLink(link, item.id)
              setSharingDiaryId(null)
            },
          },
          {
            text: 'Share…',
            onPress: async () => {
              await sharePassportInviteWithFeedback(item, tailorName)
              setSharingDiaryId(null)
            },
          },
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => setSharingDiaryId(null),
          },
        ]
      )
    } catch {
      setSharingDiaryId(null)
      Alert.alert('Unable to share invite', 'Sharing is unavailable right now. Retry from this diary entry in a moment, or come back later and try again.')
    }
  }

  const initials = (name: string) =>
    name.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')

  const recentCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
  const visibleCustomers = useMemo(() => {
    const list = filtered.filter((client) =>
      customerFilter === 'repeat' ? client.totalOrders > 1
        : customerFilter === 'recent' ? new Date(client.lastOrderDate).getTime() >= recentCutoff : true
    )
    return [...list].sort((a, b) => customerSort === 'name'
      ? a.displayName.localeCompare(b.displayName)
      : customerSort === 'orders'
        ? b.totalOrders - a.totalOrders || new Date(b.lastOrderDate).getTime() - new Date(a.lastOrderDate).getTime()
        : new Date(b.lastOrderDate).getTime() - new Date(a.lastOrderDate).getTime())
  }, [filtered, customerFilter, customerSort, recentCutoff])
  const visibleDiary = useMemo(() => diary.filter((entry) => {
    if (diarySearch.trim() && !entry.fullName.toLowerCase().includes(diarySearch.trim().toLowerCase())) return false
    if (diaryFilter === 'ready') return entry.inviteStatus === 'NOT_INVITED' && isEntryShareReady(entry)
    if (diaryFilter === 'sent') return ['LINK_COPIED', 'LINK_SHARED', 'INVITE_SENT'].includes(entry.inviteStatus)
    if (diaryFilter === 'claimed') return entry.inviteStatus === 'CLAIMED'
    return true
  }), [diary, diarySearch, diaryFilter])
  const filteredDiary = useMemo(() => {
    const grouped = diaryFilter === 'all' && !diarySearch.trim()
    if (!grouped) return visibleDiary.map((entry) => ({ ...entry, groupLabel: null as string | null }))
    const out: (DiaryRow & { groupLabel: string | null })[] = []
    for (const group of DIARY_GROUPS) {
      const members = visibleDiary.filter(group.match)
      members.forEach((entry, index) =>
        out.push({ ...entry, groupLabel: index === 0 ? `${group.label} · ${members.length}` : null }),
      )
    }
    // A status outside the four buckets still has to appear somewhere.
    const placed = new Set(out.map((entry) => entry.id))
    for (const entry of visibleDiary) if (!placed.has(entry.id)) out.push({ ...entry, groupLabel: null })
    return out
  }, [visibleDiary, diaryFilter, diarySearch])
  const sortedCustomers = customerFilter === 'all' && customerSort === 'recent'
    ? visibleCustomers.map((client, index) => ({ ...client, groupLabel: index === 0 ? (new Date(client.lastOrderDate).getTime() >= recentCutoff ? 'Last 30 days' : 'Earlier') :
      new Date(visibleCustomers[index - 1].lastOrderDate).getTime() >= recentCutoff && new Date(client.lastOrderDate).getTime() < recentCutoff ? 'Earlier' : null }))
    : visibleCustomers.map((client) => ({ ...client, groupLabel: null as string | null }))
  const openNewDiaryEntry = () => router.push({
    pathname: '/(tailor)/clients/diary/[id]',
    params: { id: 'new', historyChain: appendToHistory(undefined, '/(tailor)/clients') },
  })

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Clients</Text>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.stateTitle}>Loading your clients…</Text>
            <Text style={styles.stateHint}>
              We’re gathering your active customers and offline diary entries so your relationship context stays in one place.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Clients</Text>
        <Text style={styles.count}>{tab === 'customers' ? visibleCustomers.length : visibleDiary.length}</Text>
        {tab === 'diary' ? <View style={styles.headerActions}>
          <TouchableOpacity onPress={openNewDiaryEntry} accessibilityRole="button" accessibilityLabel="Add client to private diary" style={styles.addHeaderButton}>
            <Feather name="plus" size={19} color={Colors.textInverse} />
            <Text style={styles.addHeaderButtonText}>Add</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { void exportDiaryCsv() }} disabled={exportingDiary} accessibilityRole="button" accessibilityLabel="Export private client diary as CSV" style={styles.exportButton}>
            <Feather name="download" size={18} color={Colors.needleGreen} />
            <Text style={styles.exportButtonText}>Export all</Text>
          </TouchableOpacity>
        </View> : null}
      </View>

      {/* Tab toggle */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'customers' && styles.tabBtnActive]}
          onPress={() => selectTab('customers')}
        >
          <Text style={[styles.tabLabel, tab === 'customers' && styles.tabLabelActive]}>Customers</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'diary' && styles.tabBtnActive]}
          onPress={() => selectTab('diary')}
        >
          <Text style={[styles.tabLabel, tab === 'diary' && styles.tabLabelActive]}>Diary</Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.search}
          placeholder={tab === 'customers' ? 'Search clients…' : 'Search diary…'}
          placeholderTextColor={Colors.midGrey}
          value={tab === 'customers' ? search : diarySearch}
          onChangeText={tab === 'customers' ? onSearch : setDiarySearch}
          autoCorrect={false}
        />
      </View>

      <View style={styles.browseControls}>
        <View style={styles.filterRow}>
          {(tab === 'customers'
            ? ([['all', 'All'], ['recent', 'Recent'], ['repeat', 'Repeat']] as const)
            : ([['all', 'All'], ['ready', 'Ready to invite'], ['sent', 'Link shared / copied'], ['claimed', 'Claimed']] as const)
          ).map(([value, label]) => {
            const selected = tab === 'customers' ? customerFilter === value : diaryFilter === value
            return <TouchableOpacity key={value} onPress={() => {
              if (tab === 'customers') setCustomerFilter(value as CustomerFilter)
              else setDiaryFilter(value as DiaryFilter)
            }} style={[styles.filterChip, selected && styles.filterChipActive]} accessibilityRole="button" accessibilityState={{ selected }}>
              <Text style={[styles.filterChipText, selected && styles.filterChipTextActive]}>{label}</Text>
            </TouchableOpacity>
          })}
        </View>
        {tab === 'customers' ? <TouchableOpacity style={styles.sortButton} onPress={() => Alert.alert('Sort customers', undefined, [
          { text: 'Newest first', onPress: () => setCustomerSort('recent') },
          { text: 'Name A–Z', onPress: () => setCustomerSort('name') },
          { text: 'Most orders', onPress: () => setCustomerSort('orders') },
          { text: 'Cancel', style: 'cancel' },
        ])} accessibilityRole="button" accessibilityLabel={`Sort customers: ${customerSort === 'recent' ? 'Newest first' : customerSort === 'name' ? 'Name A to Z' : 'Most orders'}`}>
          <Feather name="sliders" size={14} color={Colors.needleGreen} />
          <Text style={styles.sortButtonText}>{customerSort === 'recent' ? 'Newest' : customerSort === 'name' ? 'Name' : 'Most orders'}</Text>
        </TouchableOpacity> : null}
      </View>

      {tab === 'diary' ? (
        <>
        {diaryLoading && <ActivityIndicator style={{ marginTop: Spacing.xl }} color={Colors.needleGreen} />}
        <FlatList
          {...capsuleNavScroll}
          data={filteredDiary}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.list, { paddingBottom: Math.max(insets.bottom + 112, 148) }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.needleGreen} />
          }
          ListEmptyComponent={
            diaryLoading ? null : diaryFetchError ? (
              <View style={styles.stateWrap}>
                <View style={styles.stateCard}>
                  <Text style={styles.stateEyebrow}>Client diary</Text>
                  <Text style={styles.stateTitle}>Couldn't load your diary.</Text>
                  <Text style={styles.stateHint}>
                    This tab should help you carry offline clients and measurements into Drapeon without losing context.
                  </Text>
                  <TouchableOpacity
                    style={styles.addDiaryBtn}
                    onPress={() => {
                      setDiaryLoading(true)
                      fetchDiary().finally(() => setDiaryLoading(false))
                    }}
                  >
                    <Text style={styles.addDiaryBtnText}>Try again</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.emptySecondaryBtn}
                    onPress={() => selectTab('customers')}
                  >
                    <Text style={styles.emptySecondaryBtnText}>View customers</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.emptySecondaryBtn}
                    onPress={() => router.replace('/(tailor)')}
                  >
                    <Text style={styles.emptySecondaryBtnText}>Open dashboard</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.empty}>
                <Feather name="book-open" size={36} color={Colors.lightGrey} style={{ marginBottom: Spacing.md }} />
                <Text style={styles.emptyTitle}>
                  {diarySearch || diaryFilter !== 'all' ? 'No matching records' : 'Build your client passport book'}
                </Text>
                <Text style={styles.emptyHint}>
                  {diarySearch || diaryFilter !== 'all'
                    ? 'Try another name or choose All diary records.'
                    : 'Add walk-in clients, record measurements, and share a claim link when they are ready to join Drapeon.'}
                </Text>
                {!diarySearch && diaryFilter === 'all' ? (
                  <TouchableOpacity
                    style={styles.addDiaryBtn}
                    onPress={() =>
                      router.push({
                        pathname: '/(tailor)/clients/diary/[id]',
                        params: { id: 'new', historyChain: appendToHistory(undefined, '/(tailor)/clients') },
                      })
                    }
                    activeOpacity={0.8}
                  >
                    <Text style={styles.addDiaryBtnText}>Add first client</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            )
          }
          renderItem={({ item }) => (
            <View>
            {item.groupLabel ? <Text style={styles.groupHeading}>{item.groupLabel}</Text> : null}
            <TouchableOpacity
              style={[styles.card, styles.diaryCard]}
              onPress={() =>
                router.push({
                  pathname: '/(tailor)/clients/diary/[id]',
                  params: { id: item.id, historyChain: appendToHistory(undefined, '/(tailor)/clients') },
                })
              }
              activeOpacity={0.75}
            >
              {/* Identity and state on one row, actions on their own. The right
                  column used to stack a pill, two buttons and a chevron, which
                  made the card tall and gave four things equal weight. */}
              <View style={styles.diaryTop}>
                <View style={[styles.avatar, { backgroundColor: Colors.needleGreenLight }]}>
                  <Text style={styles.avatarText}>{initials(item.fullName)}</Text>
                </View>
                <View style={styles.cardBody}>
                  <Text style={styles.clientName}>{item.fullName}</Text>
                  <Text style={styles.clientMeta}>
                    {item.measuredAt
                      ? new Date(item.measuredAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                      : 'No date recorded'}
                    {item.eventType ? `  ·  ${item.eventType.charAt(0) + item.eventType.slice(1).toLowerCase()}` : ''}
                  </Text>
                  {(item.chest || item.waist) && (
                    <Text style={styles.clientMeta}>
                      {item.chest ? `Chest ${item.chest}${item.unit}` : ''}
                      {item.chest && item.waist ? '  ' : ''}
                      {item.waist ? `Waist ${item.waist}${item.unit}` : ''}
                    </Text>
                  )}
                </View>
                <InviteStatusPill status={item.inviteStatus} />
              </View>
              <View style={styles.diaryActions}>
                {item.inviteStatus !== 'CLAIMED' && isEntryShareReady(item) && (
                  <TouchableOpacity
                    onPress={(event) => {
                      event.stopPropagation()
                      void handleShareCard(item)
                    }}
                    style={styles.shareCardBtn}
                    disabled={sharingDiaryId === item.id}
                    activeOpacity={0.7}
                  >
                    {sharingDiaryId === item.id ? (
                      <ActivityIndicator size="small" color={Colors.needleGreen} />
                    ) : (
                      <>
                        <Feather name="send" size={13} color={Colors.needleGreen} />
                        <Text style={styles.shareCardBtnText}>{['LINK_COPIED', 'LINK_SHARED', 'INVITE_SENT'].includes(item.inviteStatus) ? 'Share again' : 'Invite'}</Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={(event) => {
                    event.stopPropagation()
                    void exportDiaryRecordCsv(item)
                  }}
                  style={styles.shareCardBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Download ${item.fullName}'s fitting record as CSV`}
                  activeOpacity={0.7}
                >
                  <Feather name="download" size={13} color={Colors.needleGreen} />
                  <Text style={styles.shareCardBtnText}>Export</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
            </View>
          )}
        />
        </>
      ) : (
      <FlatList
        {...capsuleNavScroll}
        data={sortedCustomers}
        keyExtractor={(item) => item.customerId}
        contentContainerStyle={[styles.list, { paddingBottom: Math.max(insets.bottom + 112, 148) }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.needleGreen} />
        }
        ListEmptyComponent={
          search || customerFilter !== 'all' ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No results</Text>
              <Text style={styles.emptyHint}>Try another name or choose All customers.</Text>
            </View>
          ) : fetchError ? (
            <View style={styles.stateWrap}>
              <View style={styles.stateCard}>
                <Text style={styles.stateEyebrow}>Clients</Text>
                <Text style={styles.stateTitle}>Couldn't load your clients.</Text>
                <Text style={styles.stateHint}>
                  This tab should help you revisit repeat customers, notes, and order history without guesswork.
                </Text>
                <TouchableOpacity
                  style={styles.addDiaryBtn}
                  onPress={() => {
                    setLoading(true)
                    fetchClients().finally(() => setLoading(false))
                  }}
                >
                  <Text style={styles.addDiaryBtnText}>Try again</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.emptySecondaryBtn}
                  onPress={() => selectTab('diary')}
                >
                  <Text style={styles.emptySecondaryBtnText}>Open diary instead</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.emptySecondaryBtn}
                  onPress={() => router.replace('/(tailor)')}
                >
                  <Text style={styles.emptySecondaryBtnText}>Open dashboard</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
              <ClientsEmptyState
                isLive={tailorProfile?.isLive ?? false}
                profileId={tailorProfile?.id ?? null}
                displayName={tailorProfile?.displayName ?? ''}
                hasDiaryClients={diary.length > 0}
                onSetupPress={() => router.push('/(tailor)/profile/setup')}
              />
            )
        }
        renderItem={({ item }) => (
          <View>
          {item.groupLabel ? <Text style={styles.groupHeading}>{item.groupLabel}</Text> : null}
          <TouchableOpacity
            style={styles.card}
            onPress={() =>
              router.push({
                pathname: '/(tailor)/clients/[clientId]',
                params: { clientId: item.customerId, historyChain: appendToHistory(undefined, '/(tailor)/clients') },
              })
            }
            activeOpacity={0.75}
          >
            <AvatarImage
              uri={item.avatarUrl}
              initials={item.displayName}
              size={44}
              borderColor={Colors.lightGrey}
              borderWidth={1}
            />
            <View style={styles.cardBody}>
              <Text style={styles.clientName}>{item.displayName}</Text>
              <Text style={styles.clientMeta}>
                {item.totalOrders} order{item.totalOrders !== 1 ? 's' : ''}
                {'  ·  '}
                Last: {item.lastGarmentType}
              </Text>
            </View>
            <View style={styles.cardRight}>
              <Text style={styles.lastDate}>
                {new Date(item.lastOrderDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </Text>
              <Text style={styles.chevron}>›</Text>
            </View>
          </TouchableOpacity>
          </View>
        )}
      />
      )}
    </SafeAreaView>
  )
}

// ─── InviteStatusPill ─────────────────────────────────────────────────────────

const INVITE_PILL: Record<string, { label: string; color: string; bg: string }> = {
  NOT_INVITED: { label: 'Not invited', color: Colors.midGrey, bg: Colors.lightGrey },
  LINK_COPIED: { label: 'Link copied', color: Colors.warning, bg: Colors.warning + '20' },
  LINK_SHARED: { label: 'Link shared', color: Colors.warning, bg: Colors.warning + '20' },
  INVITE_SENT: { label: 'Link shared', color: Colors.warning, bg: Colors.warning + '20' },
  CLAIMED:     { label: 'Claimed',     color: Colors.success, bg: Colors.success + '20' },
}

function InviteStatusPill({ status }: { status: string }) {
  const cfg = INVITE_PILL[status] ?? INVITE_PILL.NOT_INVITED
  return (
    <View style={[invitePillStyles.pill, { backgroundColor: cfg.bg }]}>
      <Text style={[invitePillStyles.text, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  )
}

const invitePillStyles = StyleSheet.create({
  pill: { borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 3 },
  text: { fontSize: 10, fontWeight: FontWeight.semibold },
})

// ─── Clients empty state ─────────────────────────────────────────────────────

function GhostClientCard({ opacity }: { opacity: number }) {
  return (
    <View style={[ghostStyles.card, { opacity }]}>
      <View style={ghostStyles.avatar} />
      <View style={{ flex: 1, gap: 8 }}>
        <View style={[ghostStyles.line, { width: '55%' }]} />
        <View style={[ghostStyles.line, { width: '35%' }]} />
      </View>
      <View style={[ghostStyles.line, { width: 36 }]} />
    </View>
  )
}

function ClientsEmptyState({
  isLive, profileId, displayName, hasDiaryClients, onSetupPress,
}: {
  isLive: boolean
  profileId: string | null
  displayName: string
  hasDiaryClients: boolean
  onSetupPress: () => void
}) {
  return (
    <View style={clientEmptyStyles.wrap}>
      <View style={{ gap: 10, width: '100%', marginBottom: Spacing.xl }}>
        <GhostClientCard opacity={0.55} />
        <GhostClientCard opacity={0.32} />
        <GhostClientCard opacity={0.15} />
      </View>
      <Text style={clientEmptyStyles.heading}>{hasDiaryClients ? 'No Drapeon customers yet' : 'No clients yet'}</Text>
      <Text style={clientEmptyStyles.sub}>
        {hasDiaryClients
          ? 'Your diary clients are saved. This tab fills when someone places an order through Drapeon.'
          : 'Client relationships start here once someone places an order or you add them to your diary.'}
        {isLive ? ' Invite a client when you are ready to bring them into Drapeon.' : ' Complete your profile before customers can book you.'}
      </Text>
      <View style={clientEmptyStyles.ctaStack}>
        {isLive && profileId ? (
          <TouchableOpacity
            style={clientEmptyStyles.cta}
            onPress={() => inviteCustomerFromTailor(profileId, displayName)}
          >
            <Feather name="user-plus" size={16} color={Colors.textInverse} />
            <Text style={clientEmptyStyles.ctaText}>Invite a client</Text>
          </TouchableOpacity>
        ) : null}
        {isLive && profileId ? (
          <TouchableOpacity
            style={clientEmptyStyles.secondaryTextButton}
            onPress={() => shareTailorProfile(profileId, displayName)}
          >
            <Text style={clientEmptyStyles.secondaryText}>Share live profile instead</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={clientEmptyStyles.cta}
            onPress={onSetupPress}
          >
            <Feather name="user-check" size={16} color={Colors.textInverse} />
            <Text style={clientEmptyStyles.ctaText}>Complete profile</Text>
          </TouchableOpacity>
        )}
      </View>
      <Text style={clientEmptyStyles.ctaHint}>
        Use the diary for walk-in clients; use this tab for customers with Drapeon order history.
      </Text>
    </View>
  )
}

const ghostStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, ...Shadow.sm,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.lightGrey },
  line: { height: 10, borderRadius: 5, backgroundColor: Colors.lightGrey },
})

const clientEmptyStyles = StyleSheet.create({
  wrap: {
    paddingTop: Spacing.xl, paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xxxl,
    alignItems: 'center',
  },
  heading: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.ink, textAlign: 'center' },
  sub: {
    fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center',
    lineHeight: 20, marginTop: 6, maxWidth: 300,
  },
  ctaStack: { gap: Spacing.md, marginTop: Spacing.xl, alignItems: 'center' },
  ctaHint: {
    marginTop: Spacing.md,
    fontSize: FontSize.xs,
    color: Colors.midGrey,
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 300,
  },
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.needleGreen, borderRadius: Radius.full,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    minHeight: 48,
  },
  ctaText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textInverse },
  secondaryTextButton: { minHeight: 44, justifyContent: 'center' },
  secondaryText: { fontSize: FontSize.sm, color: Colors.needleGreen, fontWeight: FontWeight.semibold },
})

const styles = StyleSheet.create({
  browseControls: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
  filterRow: { flex: 1, flexDirection: 'row', gap: 5, flexWrap: 'wrap' },
  filterChip: { borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.lightGrey, paddingHorizontal: 10, minHeight: 32, justifyContent: 'center' },
  filterChipActive: { backgroundColor: Colors.needleGreenLight, borderColor: Colors.needleGreen },
  filterChipText: { color: Colors.inkLight, fontSize: FontSize.xs, fontWeight: FontWeight.medium },
  filterChipTextActive: { color: Colors.needleGreen, fontWeight: FontWeight.semibold },
  sortButton: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7 },
  sortButtonText: { color: Colors.needleGreen, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  groupHeading: { color: Colors.inkLight, fontSize: FontSize.xs, fontWeight: FontWeight.semibold, marginTop: 10, marginBottom: 8, paddingHorizontal: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  safe: { flex: 1, backgroundColor: Colors.bone },
  stateWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  stateCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.lg,
    alignItems: 'center',
    ...Shadow.lg,
  },
  stateEyebrow: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  stateTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.ink, textAlign: 'center' },
  stateHint: { fontSize: FontSize.sm, color: Colors.inkLight, textAlign: 'center', lineHeight: 21 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.lg, paddingTop: 10, paddingBottom: 8,
  },
  headerActions: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  addHeaderButton: {
    minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingHorizontal: 14, borderRadius: Radius.full, backgroundColor: Colors.needleGreen,
  },
  addHeaderButtonText: { color: Colors.textInverse, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  title: { fontSize: 30, fontWeight: FontWeight.bold, color: Colors.ink },
  count: {
    fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textInverse,
    backgroundColor: Colors.needleGreen, borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 4, overflow: 'hidden', minWidth: 26, textAlign: 'center',
  },
  searchWrap: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
  search: {
    backgroundColor: Colors.white, borderRadius: Radius.md,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: FontSize.sm, color: Colors.ink, ...Shadow.sm,
    minHeight: 44,
  },

  list: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxl, gap: 7 },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    backgroundColor: Colors.white, borderRadius: Radius.md,
    paddingVertical: 10, paddingHorizontal: 12, ...Shadow.sm,
  },
  avatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.needleGreenLight,
    justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { fontSize: 13, fontWeight: FontWeight.semibold, color: Colors.needleGreen },
  cardBody: { flex: 1, gap: 2 },
  clientName: { fontSize: 15, fontWeight: FontWeight.semibold, color: Colors.ink },
  clientMeta: { fontSize: FontSize.xs, color: Colors.midGrey },
  cardRight: { alignItems: 'flex-end', gap: 2 },
  // Diary entries stack: identity row, then actions. `card` is shared with the
  // customers list, which stays a single row.
  diaryCard: { flexDirection: 'column', alignItems: 'stretch', gap: Spacing.sm, paddingVertical: 13, paddingHorizontal: 13 },
  diaryTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  diaryActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  lastDate: { fontSize: FontSize.xs, color: Colors.midGrey },
  chevron: { fontSize: 20, color: Colors.midGrey, lineHeight: 22 },

  empty: { paddingTop: Spacing.xxxl, alignItems: 'center', gap: Spacing.sm },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.ink },
  emptyHint: { fontSize: FontSize.sm, color: Colors.midGrey, textAlign: 'center', maxWidth: 280, lineHeight: 20 },

  tabRow: {
    flexDirection: 'row', backgroundColor: Colors.boneDeep, borderRadius: Radius.full,
    padding: 3, marginHorizontal: Spacing.lg, marginBottom: Spacing.sm,
  },
  tabBtn: { flex: 1, paddingVertical: 9, borderRadius: Radius.full, alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  tabBtnActive: { backgroundColor: Colors.white, ...Shadow.sm },
  tabLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.midGrey },
  tabLabelActive: { color: Colors.ink, fontWeight: FontWeight.semibold },
  exportButton: { minHeight: 44, flexDirection: 'row', gap: 6, paddingHorizontal: 11, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.needleGreenLight },
  exportButtonText: { fontSize: 11, fontWeight: FontWeight.semibold, color: Colors.needleGreen },

  addDiaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.needleGreen, borderRadius: Radius.full,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md, marginTop: Spacing.xl,
  },
  addDiaryBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textInverse },
  emptySecondaryBtn: {
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
  },
  emptySecondaryBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.ink },

  // Share button inside diary card
  shareCardBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 6,
    borderWidth: 1, borderColor: Colors.needleGreen + '30',
    minHeight: 32,
  },
  shareCardBtnText: {
    fontSize: 11, fontWeight: FontWeight.semibold, color: Colors.needleGreen,
  },
})

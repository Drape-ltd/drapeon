'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, Copy, Download, Pencil, Plus, Search, Trash2, UsersRound } from 'lucide-react'
import { buildDiaryCsv, formatDate, formatDatabaseEnumLabel, type DiaryExportRow } from '@drape/shared'
import { createClient } from '../../../lib/supabase'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { NativeSelect } from '../../../components/ui/native-select'
import { StatusChip } from '../../../components/ui/status-chip'
import { Surface, SurfaceHeader } from '../../../components/ui/surface'
import { Textarea } from '../../../components/ui/textarea'
import { AccountRouteRuntime } from '../account-route-runtime'

type CustomerOrder = {
  id: string
  customer_id: string | null
  garment_type: string | null
  item_title: string | null
  stage: string | null
  created_at: string | null
}
type CustomerProfile = { user_id: string; display_name: string | null; avatar_url: string | null }
type DiaryEntry = {
  id: string
  passport_id: string | null
  full_name: string
  invite_status: string | null
  measurement_unit: 'cm' | 'in' | null
  chest: number | null
  shoulder: number | null
  sleeve: number | null
  waist: number | null
  hip: number | null
  neck: number | null
  gender: 'MALE' | 'FEMALE' | 'PREFER_NOT_TO_SAY' | null
  trouser_length: number | null
  thigh: number | null
  inseam: number | null
  ankle: number | null
  bicep: number | null
  wrist: number | null
  back_length: number | null
  under_bust: number | null
  special_fitting_notes: string | null
  client_notes: string | null
  fabric_preference: string | null
  style_preference: string | null
  event_type: string | null
  measured_at: string | null
  measured_location: string | null
  updated_at: string | null
}
type DiaryPhoto = { id: string; entry_id: string; storage_path: string; caption: string; created_at: string; url: string }
type Client = CustomerProfile & { orders: CustomerOrder[] }
type Data = { clients: Client[]; diary: DiaryEntry[] }
type State = { status: 'loading' } | { status: 'ready'; data: Data } | { status: 'error'; message: string }
type Form = {
  fullName: string
  gender: '' | 'MALE' | 'FEMALE' | 'PREFER_NOT_TO_SAY'
  unit: 'cm' | 'in'
  chest: string
  shoulder: string
  sleeve: string
  waist: string
  hip: string
  neck: string
  trouser_length: string
  thigh: string
  inseam: string
  ankle: string
  bicep: string
  wrist: string
  back_length: string
  under_bust: string
  notes: string
  specialNotes: string
  fabric: string
  style: string
  eventType: string
  measuredAt: string
  measuredLocation: 'SHOP' | 'CUSTOMER_HOME' | 'EVENT'
}

const emptyForm: Form = {
  fullName: '', gender: '', unit: 'cm', chest: '', shoulder: '', sleeve: '', waist: '', hip: '', neck: '',
  trouser_length: '', thigh: '', inseam: '', ankle: '', bicep: '', wrist: '', back_length: '', under_bust: '',
  notes: '', specialNotes: '', fabric: '', style: '', eventType: '', measuredAt: '', measuredLocation: 'SHOP',
}
const diarySelect = 'id, passport_id, full_name, invite_status, gender, measurement_unit, chest, shoulder, sleeve, waist, hip, neck, trouser_length, thigh, inseam, ankle, bicep, wrist, back_length, under_bust, client_notes, special_fitting_notes, fabric_preference, style_preference, event_type, measured_at, measured_location, updated_at'

function initials(name: string) {
  return name.split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'C'
}
function numberOrNull(value: string) {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
async function cleanDiaryPhoto(file: File): Promise<Blob> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
    throw new Error('Choose a JPEG, PNG, or WebP photo under 10 MB.')
  }
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This photo could not be prepared.')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (!blob || blob.size > 8 * 1024 * 1024) throw new Error('This photo is too large after processing.')
    return blob
  } finally { bitmap.close() }
}
function formFor(entry: DiaryEntry): Form {
  return {
    fullName: entry.full_name,
    gender: entry.gender ?? '',
    unit: entry.measurement_unit ?? 'cm',
    chest: entry.chest?.toString() ?? '', shoulder: entry.shoulder?.toString() ?? '',
    sleeve: entry.sleeve?.toString() ?? '', waist: entry.waist?.toString() ?? '',
    hip: entry.hip?.toString() ?? '', neck: entry.neck?.toString() ?? '',
    trouser_length: entry.trouser_length?.toString() ?? '', thigh: entry.thigh?.toString() ?? '',
    inseam: entry.inseam?.toString() ?? '', ankle: entry.ankle?.toString() ?? '',
    bicep: entry.bicep?.toString() ?? '', wrist: entry.wrist?.toString() ?? '',
    back_length: entry.back_length?.toString() ?? '', under_bust: entry.under_bust?.toString() ?? '',
    notes: entry.client_notes ?? '', fabric: entry.fabric_preference ?? '',
    specialNotes: entry.special_fitting_notes ?? '',
    style: entry.style_preference ?? '', eventType: entry.event_type ?? '',
    measuredAt: entry.measured_at?.slice(0, 10) ?? '',
    measuredLocation: (entry.measured_location as Form['measuredLocation'] | null) ?? 'SHOP',
  }
}
async function errorMessage(error: unknown) {
  const context = error && typeof error === 'object' ? (error as { context?: Response }).context : null
  try {
    const body = context?.clone ? await context.clone().json() as { error?: string; message?: string } : null
    return body?.message || body?.error || null
  } catch { return null }
}
async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await createClient().functions.invoke('diary-entry-action', { body })
  if (error) throw new Error((await errorMessage(error)) || 'The diary update could not finish.')
  return data as T
}
async function load(userId: string): Promise<Data> {
  const supabase = createClient()
  const [orders, diary] = await Promise.all([
    (async () => {
      const rows: CustomerOrder[] = []
      for (let start = 0; ; start += 500) {
        const { data, error } = await supabase.from('orders').select('id, customer_id, garment_type, item_title, stage, created_at').eq('tailor_id', userId).order('created_at', { ascending: false }).order('id', { ascending: false }).range(start, start + 499)
        if (error) throw new Error('Customer orders could not load. Refresh to retry.')
        const batch = (data ?? []) as CustomerOrder[]
        rows.push(...batch)
        if (batch.length < 500) return rows
      }
    })(),
    (async () => {
      const rows: DiaryEntry[] = []
      for (let start = 0; ; start += 500) {
        const { data, error } = await supabase.from('diary_entries').select(diarySelect).eq('tailor_id', userId).order('updated_at', { ascending: false }).order('id', { ascending: false }).range(start, start + 499)
        if (error) throw new Error('Diary records could not load. Refresh to retry.')
        const batch = (data ?? []) as DiaryEntry[]
        rows.push(...batch)
        if (batch.length < 500) return rows
      }
    })(),
  ])
  const ids = [...new Set(orders.map((order) => order.customer_id).filter((id): id is string => Boolean(id)))]
  const profileRows: CustomerProfile[] = []
  for (let start = 0; start < ids.length; start += 100) {
    const { data, error } = await supabase.from('customer_profiles').select('user_id, display_name, avatar_url').in('user_id', ids.slice(start, start + 100))
    if (error) throw new Error('Customer names could not load. Refresh to retry.')
    profileRows.push(...((data ?? []) as CustomerProfile[]))
  }
  const profiles = new Map(profileRows.map((profile) => [profile.user_id, profile]))
  return {
    clients: ids.map((id) => ({
      ...(profiles.get(id) ?? { user_id: id, display_name: 'Customer', avatar_url: null }),
      orders: orders.filter((order) => order.customer_id === id),
    })),
    diary,
  }
}

function ClientsContent({ data, refresh, userId, previewOnly = false }: { data: Data; refresh: () => void; userId: string; previewOnly?: boolean }) {
  const searchParams = useSearchParams()
  const initialDiaryTab = searchParams.get('tab')?.toLowerCase() === 'diary'
  const [tab, setTab] = useState<'CUSTOMERS' | 'DIARY'>(initialDiaryTab ? 'DIARY' : 'CUSTOMERS')
  const [query, setQuery] = useState('')
  const [customerFilter, setCustomerFilter] = useState<'all' | 'recent' | 'repeat'>('all')
  const [customerSort, setCustomerSort] = useState<'recent' | 'name' | 'orders'>('recent')
  const requestedDiaryFilter = searchParams.get('filter')
  const [diaryFilter, setDiaryFilter] = useState<'all' | 'ready' | 'sent' | 'claimed'>(requestedDiaryFilter === 'claimed' ? 'claimed' : 'all')
  const [editing, setEditing] = useState<DiaryEntry | 'NEW' | null>(null)
  const [form, setForm] = useState<Form>(emptyForm)
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [photos, setPhotos] = useState<DiaryPhoto[]>([])
  const [pendingPhotoFiles, setPendingPhotoFiles] = useState<File[]>([])
  const [pendingPhotoPreviews, setPendingPhotoPreviews] = useState<string[]>([])
  const [savedNewEntry, setSavedNewEntry] = useState<DiaryEntry | null>(null)
  const [createRequestId, setCreateRequestId] = useState<string | null>(null)
  const [photosLoading, setPhotosLoading] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [armedDelete, setArmedDelete] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const recentCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
  const filteredClients = useMemo(() => data.clients.filter((client) => {
    if (!(client.display_name ?? 'Customer').toLowerCase().includes(query.toLowerCase())) return false
    if (customerFilter === 'repeat') return client.orders.length > 1
    if (customerFilter === 'recent') return new Date(client.orders[0]?.created_at ?? 0).getTime() >= recentCutoff
    return true
  }).sort((a, b) => customerSort === 'name'
    ? (a.display_name ?? 'Customer').localeCompare(b.display_name ?? 'Customer')
    : customerSort === 'orders'
      ? b.orders.length - a.orders.length || new Date(b.orders[0]?.created_at ?? 0).getTime() - new Date(a.orders[0]?.created_at ?? 0).getTime()
      : new Date(b.orders[0]?.created_at ?? 0).getTime() - new Date(a.orders[0]?.created_at ?? 0).getTime()), [data.clients, query, customerFilter, customerSort, recentCutoff])
  const filteredDiary = useMemo(() => data.diary.filter((entry) => {
    if (!entry.full_name.toLowerCase().includes(query.toLowerCase())) return false
    if (diaryFilter === 'ready') return entry.invite_status === 'NOT_INVITED' && Boolean(entry.passport_id)
    if (diaryFilter === 'sent') return ['LINK_COPIED', 'LINK_SHARED', 'INVITE_SENT'].includes(entry.invite_status ?? '')
    if (diaryFilter === 'claimed') return entry.invite_status === 'CLAIMED'
    return true
  }), [data.diary, query, diaryFilter])
  const unsaved = Boolean(editing && (
    JSON.stringify(form) !== JSON.stringify(editing === 'NEW' ? (savedNewEntry ? formFor(savedNewEntry) : emptyForm) : formFor(editing)) ||
    pendingPhotoFiles.length > 0
  ))

  useEffect(() => {
    const urls = pendingPhotoFiles.map((file) => URL.createObjectURL(file))
    setPendingPhotoPreviews(urls)
    return () => urls.forEach((url) => URL.revokeObjectURL(url))
  }, [pendingPhotoFiles])

  useEffect(() => {
    if (!editing || editing === 'NEW') { setPhotos([]); return }
    let active = true
    const entryId = editing.id
    setPhotos([])
    setPhotosLoading(true)
    const supabase = createClient()
    async function loadPhotos() {
      try {
        const { data: rows, error: fetchError } = await supabase.from('diary_attachments').select('id,entry_id,storage_path,caption,created_at')
          .eq('entry_id', entryId).eq('tailor_id', userId).order('created_at', { ascending: false })
        if (fetchError) throw fetchError
        const resolved = await Promise.all((rows ?? []).map(async (row) => {
          const { data: signed, error: signError } = await supabase.storage.from('diary-photos').createSignedUrl(row.storage_path, 3600)
          if (signError || !signed) throw signError ?? new Error('Photo could not be opened.')
          return { ...row, url: signed.signedUrl } as DiaryPhoto
        }))
        if (active) setPhotos(resolved)
      } catch { if (active) setError('Private fitting photos could not load. Retry by reopening this record.') }
      finally { if (active) setPhotosLoading(false) }
    }
    void loadPhotos()
    return () => { active = false }
  }, [editing, userId])

  async function uploadPhoto(entryId: string, file: File) {
    setPhotoBusy(true); setError(null)
    const supabase = createClient()
    const path = `${userId}/${entryId}/${crypto.randomUUID()}.jpg`
    let uploaded = false
    try {
      const blob = await cleanDiaryPhoto(file)
      const { error: uploadError } = await supabase.storage.from('diary-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false })
      if (uploadError) throw uploadError
      uploaded = true
      const { data: signed, error: signError } = await supabase.storage.from('diary-photos').createSignedUrl(path, 3600)
      if (signError || !signed) throw signError ?? new Error('Photo could not be opened.')
      const { data: row, error: insertError } = await supabase.from('diary_attachments').insert({ entry_id: entryId, tailor_id: userId, storage_path: path }).select('id,entry_id,storage_path,caption,created_at').single()
      if (insertError || !row) throw insertError ?? new Error('Photo details could not be saved.')
      setPhotos((current) => [{ ...row, url: signed.signedUrl } as DiaryPhoto, ...current])
      return { ok: true as const }
    } catch (cause) {
      if (uploaded) await supabase.storage.from('diary-photos').remove([path])
      throw cause instanceof Error ? cause : new Error('This photo could not be saved.')
    } finally { setPhotoBusy(false) }
  }

  async function addPhotos(files: File[]) {
    if (!editing || photoBusy || !files.length) return
    if (files.some((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024)) {
      setError('Choose JPEG, PNG, or WebP photos under 10 MB each.')
      return
    }
    if (photos.length + pendingPhotoFiles.length + files.length > 12) { setError('This fitting record can hold up to 12 photos.'); return }
    if (editing === 'NEW' || savedNewEntry) {
      setPendingPhotoFiles((current) => [...current, ...files])
      setNotice(`${files.length} private ${files.length === 1 ? 'photo is' : 'photos are'} ready to save with this fitting record.`)
      return
    }
    setPendingPhotoFiles((current) => [...current, ...files])
    for (const file of files) {
      try {
        await uploadPhoto(editing.id, file)
        setPendingPhotoFiles((current) => {
          const completedIndex = current.indexOf(file)
          return completedIndex < 0 ? current : current.filter((_, index) => index !== completedIndex)
        })
      } catch (cause) {
        setError(`${cause instanceof Error ? cause.message : 'This photo could not be saved.'} Your selected photo is still here. Save this record to retry.`)
        return
      }
    }
    setNotice(`${files.length} private ${files.length === 1 ? 'photo' : 'photos'} saved.`)
  }

  async function removePhoto(photo: DiaryPhoto) {
    if (!window.confirm('Remove this private fitting photo?')) return
    setPhotoBusy(true); setError(null)
    try {
      const supabase = createClient()
      const { error: deleteError } = await supabase.from('diary_attachments').delete().eq('id', photo.id).eq('tailor_id', userId)
      if (deleteError) throw deleteError
      setPhotos((current) => current.filter((item) => item.id !== photo.id))
      const { error: storageError } = await supabase.storage.from('diary-photos').remove([photo.storage_path])
      if (storageError) { setError('Photo removed from the diary, but its private file needs cleanup. Contact support.'); return }
      setNotice('Fitting photo removed.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Photo could not be removed.') }
    finally { setPhotoBusy(false) }
  }

  useEffect(() => {
    if (!unsaved) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsaved])

  function closeEditor() {
    if (unsaved && !window.confirm(savedNewEntry ? 'Close this record? It is saved, but any fitting photos still shown as pending will be discarded.' : 'Discard unsaved fitting details?')) return
    setEditing(null); setSavedNewEntry(null); setCreateRequestId(null); setPendingPhotoFiles([])
  }

  function openEditor(entry: DiaryEntry | 'NEW') {
    if (unsaved && !window.confirm('Discard unsaved fitting details?')) return
    setEditing(entry); setSavedNewEntry(null); setCreateRequestId(entry === 'NEW' ? crypto.randomUUID() : null); setPendingPhotoFiles([]); setPhotos([]); setForm(entry === 'NEW' ? emptyForm : formFor(entry)); setError(null); setNotice(null); setArmedDelete(false)
  }
  function setField<K extends keyof Form>(key: K, value: Form[K]) { setForm((current) => ({ ...current, [key]: value })) }
  function payload() {
    return {
      full_name: form.fullName.trim(), gender: form.gender || null, client_notes: form.notes.trim() || null,
      measurement_unit: form.unit, chest: numberOrNull(form.chest), shoulder: numberOrNull(form.shoulder),
      sleeve: numberOrNull(form.sleeve), waist: numberOrNull(form.waist), hip: numberOrNull(form.hip), neck: numberOrNull(form.neck),
      trouser_length: numberOrNull(form.trouser_length), thigh: numberOrNull(form.thigh),
      inseam: numberOrNull(form.inseam), ankle: numberOrNull(form.ankle),
      bicep: numberOrNull(form.bicep), wrist: numberOrNull(form.wrist),
      back_length: numberOrNull(form.back_length), under_bust: numberOrNull(form.under_bust),
      fabric_preference: form.fabric.trim() || null, style_preference: form.style.trim() || null,
      event_type: form.eventType || null, special_fitting_notes: form.specialNotes.trim() || null,
      measured_at: form.measuredAt || null, measured_location: form.measuredLocation,
    }
  }
  async function save() {
    setError(null); setNotice(null)
    if (!form.fullName.trim()) { setError('Add the client name before saving.'); return }
    if (![form.chest, form.shoulder, form.sleeve, form.waist, form.hip, form.neck, form.trouser_length, form.thigh, form.inseam, form.ankle, form.bicep, form.wrist, form.back_length, form.under_bust].some((value) => value.trim())) { setError('Add at least one measurement before saving.'); return }
    setBusy(true)
    try {
      let entryId: string | null = null
      let entryForEditor: DiaryEntry | null = null
      if (editing === 'NEW') {
        if (savedNewEntry) {
          entryId = savedNewEntry.id
          entryForEditor = savedNewEntry
          await invoke({ action: 'update', entryId, entry: payload() })
        } else {
          const requestId = createRequestId ?? crypto.randomUUID()
          setCreateRequestId(requestId)
          const created = await invoke<{ entryId: string; passportId: string }>({ action: 'create', requestId, entry: payload() })
          entryId = created.entryId
          entryForEditor = { ...payload(), id: created.entryId, passport_id: created.passportId, invite_status: 'NOT_INVITED', updated_at: new Date().toISOString() } as DiaryEntry
          setSavedNewEntry(entryForEditor)
        }
      } else if (editing) {
        entryId = editing.id
        await invoke({ action: 'update', entryId, entry: payload() })
      }
      if (entryId && pendingPhotoFiles.length) {
        while (true) {
          const file = pendingPhotoFiles[0]
          if (!file) break
          try { await uploadPhoto(entryId, file) }
          catch (cause) {
            setError(`Diary record saved. Photo upload failed: ${cause instanceof Error ? cause.message : 'Please retry.'} Your selected photo is still here. Tap Save to retry.`)
            setBusy(false)
            return
          }
          setPendingPhotoFiles((current) => current.slice(1))
        }
      }
      if (editing === 'NEW' && entryForEditor) setSavedNewEntry(null)
      if (editing === 'NEW') setCreateRequestId(null)
      setPendingPhotoFiles([])
      setEditing(null); setNotice('Diary entry saved.'); refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Diary entry could not be saved.') }
    finally { setBusy(false) }
  }
  async function remove() {
    if (!editing || editing === 'NEW') return
    if (!armedDelete) { setArmedDelete(true); return }
    setBusy(true)
    try {
      const supabase = createClient()
      const { data: attachments, error: attachmentError } = await supabase.from('diary_attachments').select('storage_path').eq('entry_id', editing.id).eq('tailor_id', userId)
      if (attachmentError) throw attachmentError
      const paths = (attachments ?? []).map((photo) => photo.storage_path)
      await invoke({ action: 'delete', entryId: editing.id })
      setEditing(null); refresh()
      if (paths.length) {
        const { error: cleanupError } = await supabase.storage.from('diary-photos').remove(paths)
        if (cleanupError) { setError('Diary entry removed, but private photo cleanup needs support.'); return }
      }
      setNotice('Diary entry removed.')
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Diary entry could not be removed.') }
    finally { setBusy(false); setArmedDelete(false) }
  }
  async function copyInvite(entry: DiaryEntry) {
    setError(null); setNotice(null)
    if (entry.invite_status === 'CLAIMED') { setError('This passport has already been claimed.'); return }
    if (!entry.passport_id) { setError('Save at least one measurement before creating an invite.'); return }
    try {
      await navigator.clipboard.writeText(`https://drapeon.co/passport/claim/${entry.passport_id}`)
      try {
        await invoke({ action: 'mark-invite-copied', entryId: entry.id })
        setNotice(`Link copied for ${entry.full_name}. Paste it into a message to send it to your client.`)
        refresh()
      } catch {
        setError('The link was copied, but the diary could not record that yet. It is still ready to share. Retry copying to sync the status.')
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invite link could not be copied.') }
  }

  async function exportDiary() {
    if (exporting) return
    setError(null); setExporting(true)
    try {
      const supabase = createClient()
      const rows: DiaryExportRow[] = []
      const fields = 'full_name,gender,measurement_unit,chest,shoulder,sleeve,waist,hip,neck,trouser_length,thigh,inseam,ankle,bicep,wrist,back_length,under_bust,fabric_preference,style_preference,event_type,client_notes,special_fitting_notes,measured_at,measured_location,invite_status'
      for (let start = 0; ; start += 500) {
        const { data: page, error: fetchError } = await supabase.from('diary_entries').select(fields).eq('tailor_id', userId).order('id', { ascending: true }).range(start, start + 499)
        if (fetchError) throw fetchError
        const batch = (page ?? []) as DiaryExportRow[]
        rows.push(...batch)
        if (batch.length < 500) break
      }
      const blob = new Blob([buildDiaryCsv(rows)], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `drapeon-client-diary-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.append(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNotice(`Exported ${rows.length} private fitting records. Keep this file secure.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The diary export could not finish.')
    } finally { setExporting(false) }
  }

  function exportDiaryRecord(entry: DiaryEntry) {
    const blob = new Blob([buildDiaryCsv([entry])], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    const safeName = entry.full_name.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '') || 'client'
    link.download = `drapeon-fitting-record-${safeName}-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setNotice(`Downloaded ${entry.full_name}'s private fitting record. Keep this file secure.`)
  }

  return <div data-route-content-ready="true" className="grid gap-5 pb-10">
    <Surface>
      <div className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="inline-flex rounded-[8px] bg-ui-muted p-1" role="tablist" aria-label="Client records">
          <button type="button" role="tab" aria-selected={tab === 'CUSTOMERS'} onClick={() => { if (unsaved && !window.confirm('Discard unsaved fitting details?')) return; setTab('CUSTOMERS'); setEditing(null) }} className={`rounded-[6px] px-4 py-2 text-sm font-semibold ${tab === 'CUSTOMERS' ? 'bg-white text-needle shadow-sm' : 'text-ink/55'}`}>Customers · {data.clients.length}</button>
          <button type="button" role="tab" aria-selected={tab === 'DIARY'} onClick={() => setTab('DIARY')} className={`rounded-[6px] px-4 py-2 text-sm font-semibold ${tab === 'DIARY' ? 'bg-white text-needle shadow-sm' : 'text-ink/55'}`}>Diary · {data.diary.length}</button>
        </div>
        {tab === 'DIARY' ? <div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => void exportDiary()} disabled={exporting || previewOnly}><Download className="size-4" /> {exporting ? 'Exporting…' : 'Export diary CSV'}</Button><Button size="sm" onClick={() => openEditor('NEW')} disabled={previewOnly}><Plus className="size-4" /> New fitting record</Button></div> : null}
      </div>
      <div className="border-t border-ui-border p-5">
        <label className="relative block max-w-md"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-ink/35" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder={tab === 'CUSTOMERS' ? 'Search customers' : 'Search private diary'} /></label>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2" aria-label={tab === 'CUSTOMERS' ? 'Customer groups' : 'Diary groups'}>
            {(tab === 'CUSTOMERS'
              ? ([['all', 'All'], ['recent', 'Recent'], ['repeat', 'Repeat']] as const)
              : ([['all', 'All'], ['ready', 'Ready to invite'], ['sent', 'Link shared / copied'], ['claimed', 'Claimed']] as const)
            ).map(([value, label]) => {
              const selected = tab === 'CUSTOMERS' ? customerFilter === value : diaryFilter === value
              return <button key={value} type="button" aria-pressed={selected} onClick={() => {
                if (tab === 'CUSTOMERS') setCustomerFilter(value as typeof customerFilter)
                else setDiaryFilter(value as typeof diaryFilter)
              }} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${selected ? 'border-needle bg-needle/10 text-needle' : 'border-ui-border text-ink/60'}`}>{label}</button>
            })}
          </div>
          {tab === 'CUSTOMERS' ? <NativeSelect aria-label="Sort customers" className="w-auto min-w-36" value={customerSort} onChange={(event) => setCustomerSort(event.target.value as typeof customerSort)}><option value="recent">Recent activity</option><option value="name">Name A–Z</option><option value="orders">Most orders</option></NativeSelect> : null}
        </div>
      </div>
    </Surface>
    {notice ? <p role="status" className="rounded-[8px] border border-needle/20 bg-needle/7 px-4 py-3 text-sm font-semibold text-needle">{notice}</p> : null}
    {error ? <p role="alert" className="rounded-[8px] border border-rust/20 bg-rust/7 px-4 py-3 text-sm font-semibold text-rust">{error}</p> : null}
    {editing ? <Surface>
      <SurfaceHeader title={editing === 'NEW' ? 'New fitting record' : `Edit ${editing.full_name}`} description="Start with a name and one measurement. Add the rest as you fit, then share a Client Passport invite." />
      <div className="grid gap-4 p-5">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_9rem_12rem]"><Input aria-label="Client name" value={form.fullName} onChange={(e) => setField('fullName', e.target.value)} placeholder="Client name" /><NativeSelect aria-label="Measurement unit" value={form.unit} onChange={(e) => setField('unit', e.target.value as Form['unit'])}><option value="cm">Centimetres</option><option value="in">Inches</option></NativeSelect><Input aria-label="Measured date" type="date" value={form.measuredAt} onChange={(e) => setField('measuredAt', e.target.value)} /></div>
        <div>
          <h3 className="text-sm font-semibold text-ink">Core measurements</h3>
          <p className="mt-1 text-xs text-ink/55">Save after one measurement and complete the rest later.</p>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">{(['chest','shoulder','waist','hip'] as const).map((key) => <Input key={key} aria-label={`${key} measurement`} inputMode="decimal" value={form[key]} onChange={(e) => setField(key, e.target.value)} placeholder={`${key.charAt(0).toUpperCase()}${key.slice(1)} (${form.unit})`} />)}</div>
        </div>
        <details key={editing === 'NEW' ? 'new' : editing.id} className="rounded-[8px] border border-ui-border p-4">
          <summary className="cursor-pointer text-sm font-semibold text-needle">More fitting measurements</summary>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">{(['sleeve','trouser_length','neck','thigh','inseam','ankle','bicep','wrist','back_length','under_bust'] as const).map((key) => <Input key={key} aria-label={`${key.replaceAll('_', ' ')} measurement`} inputMode="decimal" value={form[key]} onChange={(e) => setField(key, e.target.value)} placeholder={`${key.replaceAll('_', ' ')} (${form.unit})`} />)}</div>
        </details>
        <div className="grid gap-3 md:grid-cols-3"><NativeSelect aria-label="Measured location" value={form.measuredLocation} onChange={(e) => setField('measuredLocation', e.target.value as Form['measuredLocation'])}><option value="SHOP">Tailor shop</option><option value="CUSTOMER_HOME">Customer home</option><option value="EVENT">Event</option></NativeSelect><NativeSelect aria-label="Event type" value={form.eventType} onChange={(e) => setField('eventType', e.target.value)}><option value="">No event selected</option><option value="WEDDING">Wedding</option><option value="CASUAL">Casual</option><option value="ASOEBI">Asoebi</option><option value="FORMAL">Formal</option><option value="OTHER">Other</option></NativeSelect><Input aria-label="Fabric preference" value={form.fabric} onChange={(e) => setField('fabric', e.target.value)} placeholder="Fabric preference" /></div>
        <NativeSelect aria-label="Gender optional" value={form.gender} onChange={(e) => setField('gender', e.target.value as Form['gender'])}><option value="">Gender optional</option><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="PREFER_NOT_TO_SAY">Prefer not to say</option></NativeSelect>
        <Input aria-label="Style preference" value={form.style} onChange={(e) => setField('style', e.target.value)} placeholder="Style preference" />
        <Textarea aria-label="Private client notes" value={form.notes} onChange={(e) => setField('notes', e.target.value)} rows={3} placeholder="Private fitting notes" />
        <Textarea aria-label="Special fitting notes" value={form.specialNotes} onChange={(e) => setField('specialNotes', e.target.value)} rows={3} placeholder="Alterations, posture, and special instructions" />
        <div className="rounded-[8px] border border-ui-border p-4">
          <h3 className="text-sm font-semibold text-ink">Private fitting photos</h3>
          <p className="mt-1 text-xs text-ink/55">Only you can access these images. They are not part of your public portfolio or client invite. Photos stay queued until you save this record.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2"><label className="cursor-pointer rounded-full bg-needle px-4 py-2 text-sm font-semibold text-white">{photoBusy ? 'Saving photo…' : pendingPhotoFiles.length ? 'Add more photos' : 'Add photo'}<input type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={photoBusy || busy} onChange={(event) => { const files = [...(event.target.files ?? [])]; if (files.length) void addPhotos(files); event.currentTarget.value = '' }} /></label><span className="text-xs text-ink/55">Describe the photo in Fitting notes above.</span></div>
          {pendingPhotoFiles.length ? <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">{pendingPhotoFiles.map((file, index) => <div key={`${file.name}-${file.lastModified}-${index}`} className="overflow-hidden rounded-[8px] border border-ui-border">{pendingPhotoPreviews[index] ? <Image src={pendingPhotoPreviews[index]} alt={`Selected private fitting photo ${index + 1}`} width={300} height={220} unoptimized className="aspect-[4/3] w-full object-cover" /> : <div className="aspect-[4/3] animate-pulse bg-ui-muted" />}<div className="flex items-center justify-between gap-2 p-2"><p className="truncate text-xs text-ink/65">Ready to save</p><button type="button" className="shrink-0 text-xs font-semibold text-rust" disabled={busy} onClick={() => setPendingPhotoFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button></div></div>)}</div> : null}
          {editing !== 'NEW' && <>
            {photosLoading ? <p className="mt-3 text-sm text-ink/60">Loading photos…</p> : null}
            {photos.length ? <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">{photos.map((photo) => <div key={photo.id} className="overflow-hidden rounded-[8px] border border-ui-border"><Image src={photo.url} alt={photo.caption || 'Private fitting photo'} width={300} height={220} unoptimized className="aspect-[4/3] w-full object-cover" /><div className="p-2"><p className="truncate text-xs text-ink/65">{photo.caption || 'Fitting photo'}</p><button type="button" className="mt-1 text-xs font-semibold text-rust" disabled={photoBusy} onClick={() => void removePhoto(photo)}>Remove photo</button></div></div>)}</div> : null}
          </>}
        </div>
        <div className="flex flex-wrap gap-2"><Button onClick={() => void save()} disabled={busy || photoBusy}>{busy ? 'Saving…' : photoBusy ? 'Saving photo…' : pendingPhotoFiles.length ? 'Save with photos' : 'Save diary entry'}</Button><Button variant="secondary" onClick={closeEditor} disabled={busy || photoBusy}>Cancel</Button>{editing !== 'NEW' ? <Button variant="secondary" className="text-rust" onClick={() => void remove()} disabled={busy || photoBusy}><Trash2 className="size-4" />{armedDelete ? 'Confirm remove' : 'Remove'}</Button> : null}</div>
      </div>
    </Surface> : null}
    {tab === 'CUSTOMERS' ? <section className="grid gap-3 md:grid-cols-2">
      {filteredClients.map((client, index) => {
        const name = client.display_name?.trim() || 'Customer'
        const latest = client.orders[0]
        const recent = new Date(latest?.created_at ?? 0).getTime() >= recentCutoff
        const previousRecent = index > 0 && new Date(filteredClients[index - 1]?.orders[0]?.created_at ?? 0).getTime() >= recentCutoff
        const heading = customerFilter === 'all' && customerSort === 'recent'
          ? index === 0 ? (recent ? 'Recent activity' : 'Earlier customers') : previousRecent && !recent ? 'Earlier customers' : null
          : null
        return <div key={client.user_id} className="contents">
          {heading ? <h2 className="col-span-full mt-2 text-xs font-semibold uppercase tracking-wide text-ink/55">{heading}</h2> : null}
          <Surface><div className="flex items-start gap-4 p-5">
            <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-needle/9 font-semibold text-needle">{client.avatar_url ? <Image src={client.avatar_url} alt="" width={48} height={48} unoptimized className="size-full object-cover" /> : initials(name)}</div>
            <div className="min-w-0 flex-1"><h3 className="font-semibold text-ink">{name}</h3><p className="mt-1 text-sm text-ink/55">{client.orders.length} {client.orders.length === 1 ? 'order' : 'orders'} · Last {formatDate(latest?.created_at, { fallback: 'date unavailable' })}</p>{latest ? previewOnly ? <span className="mt-3 inline-flex text-sm font-semibold text-needle">Open latest order</span> : <Link href={`/account/orders/${latest.id}`} className="mt-3 inline-flex text-sm font-semibold text-needle">Open latest order</Link> : null}</div>
            {latest ? <StatusChip status={latest.stage} fallback="Order" /> : null}
          </div></Surface>
        </div>
      })}
      {!filteredClients.length ? <Surface><div className="p-7 text-center"><UsersRound className="mx-auto size-6 text-needle" /><h2 className="mt-3 font-semibold text-ink">No customers found</h2><p className="mt-1 text-sm text-ink/55">{query || customerFilter !== 'all' ? 'Try another name or choose All customers.' : 'Platform customers appear after they place an order.'}</p></div></Surface> : null}
    </section> : <section className="grid gap-3 md:grid-cols-2">
      {filteredDiary.map((entry) => <Surface key={entry.id}><div className="p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-needle">Private diary</p><h2 className="mt-1 text-lg font-semibold text-ink">{entry.full_name}</h2><p className="mt-1 text-sm text-ink/50"><CalendarDays className="mr-1 inline size-4" />{formatDate(entry.measured_at || entry.updated_at, { fallback: 'Date not recorded' })} · {entry.measurement_unit ?? 'cm'}</p></div><StatusChip status={entry.invite_status === 'INVITE_SENT' ? 'LINK_SHARED' : entry.invite_status} fallback="Not invited" /></div><div className="mt-4 flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => openEditor(entry)} disabled={previewOnly}><Pencil className="size-4" /> Edit</Button><Button size="sm" variant="secondary" onClick={() => exportDiaryRecord(entry)} aria-label={`Download ${entry.full_name}'s fitting record as CSV`}><Download className="size-4" /> Record CSV</Button>{entry.invite_status !== 'CLAIMED' ? <Button size="sm" variant="secondary" onClick={() => void copyInvite(entry)} disabled={!entry.passport_id || previewOnly}><Copy className="size-4" /> {['LINK_COPIED', 'LINK_SHARED', 'INVITE_SENT'].includes(entry.invite_status ?? '') ? 'Copy link again' : 'Copy invite'}</Button> : null}</div></div></Surface>)}
      {!filteredDiary.length ? <Surface><div className="p-7 text-center"><CalendarDays className="mx-auto size-6 text-needle" /><h2 className="mt-3 font-semibold text-ink">{query || diaryFilter !== 'all' ? 'No matching records' : 'Your private diary is empty'}</h2><p className="mt-1 text-sm text-ink/55">{query || diaryFilter !== 'all' ? 'Try another name or choose All diary records.' : 'Add an offline client only with their consent, then record the fitting details you need.'}</p>{!query && diaryFilter === 'all' ? <Button className="mt-4" size="sm" onClick={() => openEditor('NEW')} disabled={previewOnly}><Plus className="size-4" /> New diary client</Button> : null}</div></Surface> : null}
    </section>}
  </div>
}

function ClientsRoute({ userId }: { userId: string }) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<State>({ status: 'loading' })
  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  useEffect(() => { let active = true; void load(userId).then((data) => { if (active) setState({ status: 'ready', data }) }).catch((cause) => { if (active) setState({ status: 'error', message: cause instanceof Error ? cause.message : 'Clients could not load.' }) }); return () => { active = false } }, [revision, userId])
  if (state.status === 'loading') return <section className="app-surface p-7" aria-busy="true">Loading clients…</section>
  if (state.status === 'error') return <section className="app-surface p-7" role="alert"><h2 className="text-2xl font-semibold text-ink">Clients unavailable</h2><p className="mt-2 text-sm text-ink/60">{state.message}</p><Button className="mt-5" onClick={refresh}>Try again</Button></section>
  return <ClientsContent data={state.data} refresh={refresh} userId={userId} />
}

export function ClientsWorkspace() {
  return <AccountRouteRuntime surface="clients">{({ session }) => <ClientsRoute userId={session.user.id} />}</AccountRouteRuntime>
}


/** Synthetic, development-only layout fixture. Never query or mutate real client data here. */
export function ClientsPreview() {
  const now = Date.now()
  const makeOrder = (id: string, customerId: string, daysAgo: number): CustomerOrder => ({
    id, customer_id: customerId, garment_type: 'Kaftan', item_title: 'Custom kaftan', stage: 'IN_PROGRESS',
    created_at: new Date(now - daysAgo * 86400000).toISOString(),
  })
  const data: Data = {
    clients: [
      { user_id: 'preview-ada', display_name: 'Ada Okafor', avatar_url: null, orders: [makeOrder('preview-order-1', 'preview-ada', 2), makeOrder('preview-order-2', 'preview-ada', 90)] },
      { user_id: 'preview-seyi', display_name: 'Seyi Adeyemi', avatar_url: null, orders: [makeOrder('preview-order-3', 'preview-seyi', 9)] },
      { user_id: 'preview-zainab', display_name: 'Zainab Ibrahim', avatar_url: null, orders: [makeOrder('preview-order-4', 'preview-zainab', 65), makeOrder('preview-order-5', 'preview-zainab', 110)] },
    ],
    diary: [
      { id: 'preview-diary-1', passport_id: 'preview-passport-1', full_name: 'Amara Bello', invite_status: 'NOT_INVITED', measurement_unit: 'cm', chest: 90, shoulder: null, sleeve: null, waist: null, hip: null, neck: null, gender: null, trouser_length: null, thigh: null, inseam: null, ankle: null, bicep: null, wrist: null, back_length: null, under_bust: null, special_fitting_notes: null, client_notes: null, fabric_preference: null, style_preference: null, event_type: null, measured_at: null, measured_location: null, updated_at: new Date(now).toISOString() },
      { id: 'preview-diary-2', passport_id: 'preview-passport-2', full_name: 'Bola Nwosu', invite_status: 'INVITE_SENT', measurement_unit: 'in', chest: 36, shoulder: null, sleeve: null, waist: null, hip: null, neck: null, gender: null, trouser_length: null, thigh: null, inseam: null, ankle: null, bicep: null, wrist: null, back_length: null, under_bust: null, special_fitting_notes: null, client_notes: null, fabric_preference: null, style_preference: null, event_type: null, measured_at: null, measured_location: null, updated_at: new Date(now - 4 * 86400000).toISOString() },
    ],
  }
  return <div className="mx-auto max-w-5xl p-4 md:p-8"><p className="mb-4 text-xs font-semibold uppercase tracking-wide text-ink/50">Layout preview · synthetic records · actions disabled</p><ClientsContent data={data} userId="preview-only" refresh={() => {}} previewOnly /></div>
}

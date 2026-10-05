/**
 * Diary entry — add (id === 'new') or edit an existing offline client record.
 * Covers: customer info, full measurement set, tailor notes, session details.
 * Safety policy: no phone number or email stored.
 * Invite button sends a Client Passport claim link via the system share sheet.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { styles, sectionStyles, fieldStyles, measureStyles, segStyles } from '@/features/clients/diary-entry-styles'
import {
  View, Text, Image, ScrollView, TextInput,
  TouchableOpacity, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform, Modal,
} from 'react-native'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker'
import * as ImagePicker from 'expo-image-picker'
import { supabase, invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { goBackOrReturnTo, pickSafeReturnTo } from '@/lib/navigation'
import { useContextualBackHandler } from '@/lib/use-contextual-back'
import { sharePassportInvite } from '@/lib/invite'
import { Colors, Spacing } from '@/constants/theme'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from '@/lib/function-errors'
import { Sentry } from '@/lib/sentry'
import { ChoiceSheet } from '@/components/ui'
import { stripExif } from '@/lib/stripExif'
import { uploadPrivateStorageImage } from '@/lib/storage-upload'

// ─── Types ────────────────────────────────────────────────────────────────────

type MeasurementUnit = 'cm' | 'in'
type Gender = 'MALE' | 'FEMALE' | 'PREFER_NOT_TO_SAY' | ''
type EventType = 'WEDDING' | 'CASUAL' | 'ASOEBI' | 'FORMAL' | 'OTHER' | ''
type MeasuredLocation = 'SHOP' | 'CUSTOMER_HOME' | 'EVENT'
type DiaryMeasurementModuleKey = 'lengths' | 'upper' | 'lower'
type DiaryPhoto = { id: string; storage_path: string; caption: string; url: string }

interface DiaryForm {
  fullName: string
  gender: Gender
  clientNotes: string
  // Measurements
  unit: MeasurementUnit
  chest: string
  shoulder: string
  sleeve: string
  waist: string
  hip: string
  trouserLength: string
  neck: string
  thigh: string
  inseam: string
  ankle: string
  bicep: string
  wrist: string
  backLength: string
  underBust: string
  // Tailor notes
  fabricPreference: string
  stylePreference: string
  eventType: EventType
  specialFittingNotes: string
  // Session
  measuredAt: Date | null
  measuredLocation: MeasuredLocation
}

type DiaryEntryRow = {
  passport_id: string | null
  invite_status: string | null
  full_name: string | null
  gender: Gender | null
  client_notes: string | null
  measurement_unit: MeasurementUnit | null
  chest: number | null
  shoulder: number | null
  sleeve: number | null
  waist: number | null
  hip: number | null
  trouser_length: number | null
  neck: number | null
  thigh: number | null
  inseam: number | null
  ankle: number | null
  bicep: number | null
  wrist: number | null
  back_length: number | null
  under_bust: number | null
  fabric_preference: string | null
  style_preference: string | null
  event_type: EventType | null
  special_fitting_notes: string | null
  custom_measurements: Record<string, unknown> | null
  measured_at: string | null
  measured_location: MeasuredLocation | null
}

type TailorDisplayNameRow = {
  display_name: string | null
}

type DiaryEntryPayload = {
  tailor_id: string
  full_name: string
  gender: Gender | null
  client_notes: string | null
  measurement_unit: MeasurementUnit
  chest: number | null
  shoulder: number | null
  sleeve: number | null
  waist: number | null
  hip: number | null
  trouser_length: number | null
  neck: number | null
  thigh: number | null
  inseam: number | null
  ankle: number | null
  bicep: number | null
  wrist: number | null
  back_length: number | null
  under_bust: number | null
  fabric_preference: string | null
  style_preference: string | null
  event_type: EventType | null
  special_fitting_notes: string | null
  measured_at: string | null
  measured_location: MeasuredLocation
  updated_at: string
}

const EMPTY_FORM: DiaryForm = {
  fullName: '', gender: '', clientNotes: '',
  unit: 'cm',
  chest: '', shoulder: '', sleeve: '', waist: '',
  hip: '', trouserLength: '', neck: '', thigh: '',
  inseam: '', ankle: '', bicep: '', wrist: '',
  backLength: '', underBust: '',
  fabricPreference: '', stylePreference: '', eventType: '', specialFittingNotes: '',
  measuredAt: new Date(), measuredLocation: 'SHOP',
}

function readDiaryCustomMeasurements(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []

  return Object.entries(value as Record<string, unknown>)
    .map(([name, rawValue]) => {
      const numericValue = typeof rawValue === 'number'
        ? rawValue
        : typeof rawValue === 'string'
          ? Number.parseFloat(rawValue)
          : null
      if (numericValue == null || !Number.isFinite(numericValue)) return null
      if (/(confidence|output kind|pipeline|scan flow|height input)$/i.test(name)) return null
      return {
        name,
        value: numericValue.toFixed(2).replace(/\.?0+$/, ''),
      }
    })
    .filter((item): item is { name: string; value: string } => !!item)
}

function diaryPhotoId() {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16)
    return (char === 'x' ? random : (random & 0x3) | 0x8).toString(16)
  })
}

const DIARY_MEASUREMENT_MODULES: Array<{
  value: DiaryMeasurementModuleKey
  title: string
  body: string
  icon: keyof typeof Feather.glyphMap
}> = [
  {
    value: 'lengths',
    title: 'Lengths',
    body: 'Sleeve, trouser length, inseam, and back length.',
    icon: 'maximize-2',
  },
  {
    value: 'upper',
    title: 'Upper body detail',
    body: 'Neck, bicep, wrist, and under bust.',
    icon: 'watch',
  },
  {
    value: 'lower',
    title: 'Lower body detail',
    body: 'Thigh and ankle or cuff measurements.',
    icon: 'align-justify',
  },
]

// ─── Component ────────────────────────────────────────────────────────────────

export default function DiaryEntryScreen() {
  const { id, historyChain, returnTo } = useLocalSearchParams<{
    id: string
    historyChain?: string
    returnTo?: string
  }>()
  const isNew = id === 'new'
  const createRequestId = useRef<string | null>(isNew ? diaryPhotoId() : null)
  const router = useRouter()
  const navigation = useNavigation()
  const { user } = useAuth()
  const userId = user?.id ?? null

  const [form, setForm] = useState<DiaryForm>(EMPTY_FORM)
  const savedForm = useRef<DiaryForm>(EMPTY_FORM)
  const leavingAfterConfirmation = useRef(false)
  const [errors, setErrors] = useState<{ name?: string; measurements?: string }>({})
  const [showTopError, setShowTopError] = useState(false)
  const [passportId, setPassportId] = useState<string | null>(null)

  const scrollRef = useRef<ScrollView>(null)
  const nameFieldY = useRef(0)
  const measurementsY = useRef(0)
  const [inviteStatus, setInviteStatus] = useState<string>('NOT_INVITED')
  const [tailorDisplayName, setTailorDisplayName] = useState('')
  const [saving, setSaving] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [loading, setLoading] = useState(!isNew)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [fetchError, setFetchError] = useState(false)
  const [measurementModuleSheetOpen, setMeasurementModuleSheetOpen] = useState(false)
  const [visibleMeasurementModules, setVisibleMeasurementModules] = useState<DiaryMeasurementModuleKey[]>([])
  const [diaryCustomMeasurements, setDiaryCustomMeasurements] = useState<Array<{ name: string; value: string }>>([])
  const [photos, setPhotos] = useState<DiaryPhoto[]>([])
  const [pendingPhotos, setPendingPhotos] = useState<ImagePicker.ImagePickerAsset[]>([])
  const [savedNewEntryId, setSavedNewEntryId] = useState<string | null>(null)
  const [pendingPhotoUploadError, setPendingPhotoUploadError] = useState(false)
  const [photosLoading, setPhotosLoading] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)

  const loadPhotos = useCallback(async () => {
    if (isNew || !id || !userId) return
    setPhotosLoading(true)
    try {
      const { data, error } = await supabase.from('diary_attachments')
        .select('id,storage_path,caption').eq('entry_id', id).eq('tailor_id', userId)
        .order('created_at', { ascending: false })
      if (error) throw error
      const resolved = await Promise.all((data ?? []).map(async (photo) => {
        const { data: signed, error: signError } = await supabase.storage.from('diary-photos').createSignedUrl(photo.storage_path, 3600)
        if (signError || !signed) throw signError ?? new Error('Photo could not be opened.')
        return { ...photo, url: signed.signedUrl } as DiaryPhoto
      }))
      setPhotos(resolved)
    } catch {
      Alert.alert('Photos unavailable', 'Private fitting photos could not load. Reopen the record to retry.')
    } finally { setPhotosLoading(false) }
  }, [id, isNew, userId])

  async function uploadPhotoForEntry(entryId: string, uri: string) {
    if (!userId) throw new Error('Sign in again before saving a photo.')
    setPhotoBusy(true)
    const path = `${userId}/${entryId}/${diaryPhotoId()}.jpg`
    let uploaded = false
    try {
      const cleanUri = await stripExif(uri, { maxWidth: 1600, compress: 0.85 })
      await uploadPrivateStorageImage({ bucket: 'diary-photos', path, uri: cleanUri, contentType: 'image/jpeg', maxBytes: 8 * 1024 * 1024, allowedContentTypes: ['image/jpeg'] })
      uploaded = true
      const { data: signed, error: signError } = await supabase.storage.from('diary-photos').createSignedUrl(path, 3600)
      if (signError || !signed) throw signError ?? new Error('Photo could not be opened.')
      const { data: row, error } = await supabase.from('diary_attachments')
        .insert({ entry_id: entryId, tailor_id: userId, storage_path: path })
        .select('id,storage_path,caption').single()
      if (error || !row) throw error ?? new Error('Photo details could not be saved.')
      setPhotos((current) => [{ ...row, url: signed.signedUrl }, ...current])
    } catch (error) {
      if (uploaded) await supabase.storage.from('diary-photos').remove([path])
      throw error
    } finally { setPhotoBusy(false) }
  }

  async function addPhoto(source: 'camera' | 'library') {
    if (!userId || photoBusy) return
    if (photos.length + pendingPhotos.length >= 12) { Alert.alert('Photo limit', 'You can save up to 12 fitting photos per client record.'); return }
    try {
    const permission = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) { Alert.alert('Photo access needed', 'Allow access to attach a private fitting photo.'); return }
    const picked = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 })
    const asset = picked.canceled ? null : picked.assets?.[0]
    if (!asset?.uri) return
    if (isNew || savedNewEntryId) {
      setPendingPhotos((current) => [...current, asset])
      setPendingPhotoUploadError(false)
      return
    }
    setPendingPhotos((current) => [...current, asset])
    setPendingPhotoUploadError(false)
    try {
      await uploadPhotoForEntry(id, asset.uri)
      setPendingPhotos((current) => current.filter((photo) => photo.uri !== asset.uri))
    } catch (error) {
      setPendingPhotoUploadError(true)
      Alert.alert(
        'Photo not saved',
        `${error instanceof Error ? error.message : 'Please try again.'} Your selected photo is still here. Tap Save to retry.`,
      )
    }
    } catch (error) { Alert.alert('Photo unavailable', error instanceof Error ? error.message : 'Please try again.') }
  }

  function choosePhotoSource() {
    Alert.alert('Add fitting photo', 'This photo stays private in your client diary.', [
      { text: 'Take photo', onPress: () => { void addPhoto('camera') } },
      { text: 'Choose from photos', onPress: () => { void addPhoto('library') } },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  function removePhoto(photo: DiaryPhoto) {
    Alert.alert('Remove fitting photo?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        setPhotoBusy(true)
        const { error } = await supabase.from('diary_attachments').delete().eq('id', photo.id).eq('tailor_id', userId)
        if (error) { setPhotoBusy(false); Alert.alert('Photo not removed', 'Please try again.'); return }
        const { error: storageError } = await supabase.storage.from('diary-photos').remove([photo.storage_path])
        setPhotos((current) => current.filter((item) => item.id !== photo.id))
        setPhotoBusy(false)
        if (storageError) Alert.alert('Cleanup incomplete', 'The photo is no longer in your diary, but its private file needs cleanup. Contact support.')
      } },
    ])
  }

  function goBack() {
    const hasUnsavedChanges = JSON.stringify(form) !== JSON.stringify(savedForm.current) || pendingPhotos.length > 0
    if (!leavingAfterConfirmation.current && hasUnsavedChanges) {
      const message = savedNewEntryId && pendingPhotos.length
        ? 'This diary record is saved, but selected fitting photos are still waiting to upload. Leaving now will discard those photos.'
        : 'Your fitting details or selected photos have not been saved yet.'
      Alert.alert('Keep these changes?', message, [
        { text: 'Continue editing', style: 'cancel' },
        { text: 'Discard changes', style: 'destructive', onPress: () => {
          leavingAfterConfirmation.current = true
          goBackOrReturnTo(router, navigation, pickSafeReturnTo(historyChain, returnTo), '/(tailor)/clients')
        } },
      ])
      return
    }
    goBackOrReturnTo(router, navigation, pickSafeReturnTo(historyChain, returnTo), '/(tailor)/clients')
  }

  useContextualBackHandler(goBack)

  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if (leavingAfterConfirmation.current || (JSON.stringify(form) === JSON.stringify(savedForm.current) && pendingPhotos.length === 0)) return
    event.preventDefault()
    const message = savedNewEntryId && pendingPhotos.length
      ? 'This diary record is saved, but selected fitting photos are still waiting to upload. Leaving now will discard those photos.'
      : 'Your fitting details or selected photos have not been saved yet.'
    Alert.alert('Keep these changes?', message, [
      { text: 'Continue editing', style: 'cancel' },
      { text: 'Discard changes', style: 'destructive', onPress: () => {
        leavingAfterConfirmation.current = true
        navigation.dispatch(event.data.action)
      } },
    ])
  }), [form, navigation, pendingPhotos.length, savedNewEntryId])

  function toggleMeasurementModule(moduleKey: DiaryMeasurementModuleKey) {
    setVisibleMeasurementModules((previous) =>
      previous.includes(moduleKey)
        ? previous.filter((key) => key !== moduleKey)
        : [...previous, moduleKey]
    )
  }

  function hasModuleValue(moduleKey: DiaryMeasurementModuleKey) {
    if (moduleKey === 'lengths') {
      return !!(form.sleeve || form.trouserLength || form.inseam || form.backLength)
    }
    if (moduleKey === 'upper') {
      return !!(form.neck || form.bicep || form.wrist || form.underBust)
    }
    return !!(form.thigh || form.ankle)
  }

  function showMeasurementModule(moduleKey: DiaryMeasurementModuleKey) {
    return visibleMeasurementModules.includes(moduleKey) || hasModuleValue(moduleKey)
  }

  const loadEntry = useCallback(async () => {
    if (isNew || !id) return
    setFetchError(false)
    setLoading(true)
    const { data, error } = await supabase
      .from('diary_entries')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (error) {
      setFetchError(true)
      setLoading(false)
      return
    }

    if (!data) {
      setLoading(false)
      return
    }

    const r = data as DiaryEntryRow
    setPassportId(r.passport_id)
    setInviteStatus(r.invite_status ?? 'NOT_INVITED')
    const loadedForm: DiaryForm = {
      fullName: r.full_name ?? '',
      gender: r.gender ?? '',
      clientNotes: r.client_notes ?? '',
      unit: r.measurement_unit ?? 'cm',
      chest: r.chest != null ? String(r.chest) : '',
      shoulder: r.shoulder != null ? String(r.shoulder) : '',
      sleeve: r.sleeve != null ? String(r.sleeve) : '',
      waist: r.waist != null ? String(r.waist) : '',
      hip: r.hip != null ? String(r.hip) : '',
      trouserLength: r.trouser_length != null ? String(r.trouser_length) : '',
      neck: r.neck != null ? String(r.neck) : '',
      thigh: r.thigh != null ? String(r.thigh) : '',
      inseam: r.inseam != null ? String(r.inseam) : '',
      ankle: r.ankle != null ? String(r.ankle) : '',
      bicep: r.bicep != null ? String(r.bicep) : '',
      wrist: r.wrist != null ? String(r.wrist) : '',
      backLength: r.back_length != null ? String(r.back_length) : '',
      underBust: r.under_bust != null ? String(r.under_bust) : '',
      fabricPreference: r.fabric_preference ?? '',
      stylePreference: r.style_preference ?? '',
      eventType: r.event_type ?? '',
      specialFittingNotes: r.special_fitting_notes ?? '',
      measuredAt: r.measured_at ? new Date(r.measured_at) : null,
      measuredLocation: r.measured_location ?? 'SHOP',
    }
    savedForm.current = loadedForm
    setForm(loadedForm)
    setDiaryCustomMeasurements(readDiaryCustomMeasurements(r.custom_measurements))
    void loadPhotos()
    setLoading(false)
  }, [id, isNew, loadPhotos])

  // Load existing entry
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!isNew && id) {
        void loadEntry()
      }

      if (userId) {
        supabase
          .from('tailor_profiles')
          .select('display_name')
          .eq('user_id', userId)
          .maybeSingle()
          .then(({ data }) => {
            const row = data as TailorDisplayNameRow | null
            if (row) setTailorDisplayName(row.display_name ?? '')
          })
      }
    }, 0)
    return () => clearTimeout(timer)
  }, [id, isNew, loadEntry, userId])

  function set(key: keyof DiaryForm, value: string | Date | null) {
    setForm((f) => ({ ...f, [key]: value }))
    if (key === 'fullName') setErrors((e) => ({ ...e, name: undefined }))
    if (['chest','shoulder','sleeve','waist','hip','trouserLength','neck','thigh','inseam','ankle','bicep','wrist','backLength','underBust'].includes(key as string)) {
      setErrors((e) => ({ ...e, measurements: undefined }))
    }
  }

  function scrollToY(y: number) {
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true })
  }

  function validate(): boolean {
    const newErrors: { name?: string; measurements?: string } = {}

    if (!form.fullName.trim()) {
      newErrors.name = 'Customer name is required.'
    }

    const filledCount = [
      form.chest, form.shoulder, form.sleeve, form.waist, form.hip,
      form.trouserLength, form.neck, form.thigh, form.inseam, form.ankle,
      form.bicep, form.wrist, form.backLength, form.underBust,
    ].filter((v) => v.trim() !== '').length

    if (filledCount < 1) {
      newErrors.measurements = 'Add at least one measurement. You can return to complete the fitting later.'
    }

    setErrors(newErrors)

    const hasErrors = Object.keys(newErrors).length > 0
    if (hasErrors) {
      setShowTopError(true)
      if (newErrors.name) scrollToY(nameFieldY.current)
      else if (newErrors.measurements) scrollToY(measurementsY.current)
    }
    return !hasErrors
  }

  function parseNum(s: string): number | null {
    const n = parseFloat(s)
    return isNaN(n) ? null : n
  }

  async function handleSave() {
    if (saving || photoBusy) return
    if (!validate()) return
    if (!userId) {
      Alert.alert('Session expired', 'Please sign in again before saving this diary entry.')
      return
    }
    setSaving(true)

    const payload: DiaryEntryPayload = {
      tailor_id: userId,
      full_name: form.fullName.trim(),
      gender: form.gender || null,
      client_notes: form.clientNotes.trim() || null,
      measurement_unit: form.unit,
      chest: parseNum(form.chest),
      shoulder: parseNum(form.shoulder),
      sleeve: parseNum(form.sleeve),
      waist: parseNum(form.waist),
      hip: parseNum(form.hip),
      trouser_length: parseNum(form.trouserLength),
      neck: parseNum(form.neck),
      thigh: parseNum(form.thigh),
      inseam: parseNum(form.inseam),
      ankle: parseNum(form.ankle),
      bicep: parseNum(form.bicep),
      wrist: parseNum(form.wrist),
      back_length: parseNum(form.backLength),
      under_bust: parseNum(form.underBust),
      fabric_preference: form.fabricPreference.trim() || null,
      style_preference: form.stylePreference.trim() || null,
      event_type: form.eventType || null,
      special_fitting_notes: form.specialFittingNotes.trim() || null,
      measured_at: form.measuredAt ? form.measuredAt.toISOString().split('T')[0] : null,
      measured_location: form.measuredLocation,
      updated_at: new Date().toISOString(),
    }

    let error: Error | null = null
    let createdEntryId: string | null = savedNewEntryId
    if (isNew && !savedNewEntryId) {
      const res = await invokeFunction<{ ok: boolean; entryId?: string; passportId?: string }>('diary-entry-action', {
        body: { action: 'create', requestId: createRequestId.current ?? undefined, entry: payload },
      })
      error = res.error
      createdEntryId = res.data?.entryId ?? null
      if (!error && !createdEntryId) error = new Error('The diary record was saved but its identifier was missing. Reopen the Clients tab and check before retrying.')
      if (!error && createdEntryId) setSavedNewEntryId(createdEntryId)
      if (!error && res.data?.passportId) setPassportId(res.data.passportId)
    } else if (!isNew || savedNewEntryId) {
      const res = await invokeFunction('diary-entry-action', {
        body: { action: 'update', entryId: isNew ? savedNewEntryId : id, entry: payload },
      })
      error = res.error
    }

    if (error) {
      setSaving(false)
      Sentry.captureException(error, {
        extra: {
          context: isNew ? 'tailor_diary_create' : 'tailor_diary_update',
          diaryId: isNew ? null : id,
          userId: user?.id,
        },
      })
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. Your diary details are still here, so retry when the signal improves.'
        : await readFunctionErrorMessage(error, 'We could not save this diary entry right now. Please try again in a moment.')
      Alert.alert('Diary not saved', message)
    } else {
      const photoEntryId = isNew ? createdEntryId : id
      if (photoEntryId && pendingPhotos.length) {
        try {
          for (const asset of pendingPhotos) {
            await uploadPhotoForEntry(photoEntryId, asset.uri)
            setPendingPhotos((current) => current.slice(1))
          }
          setPendingPhotoUploadError(false)
        } catch (uploadError) {
          setPendingPhotoUploadError(true)
          setSaving(false)
          Alert.alert('Record saved, photo needs retry', uploadError instanceof Error ? uploadError.message : 'Your selected photo is still here. Tap Save to retry the upload.')
          return
        }
      }
      setSaving(false)
      savedForm.current = form
      if (isNew) {
        leavingAfterConfirmation.current = true
        if (createdEntryId) router.replace({
          pathname: '/(tailor)/clients/diary/[id]',
          params: { id: createdEntryId, historyChain, returnTo },
        })
        else goBack()
      }
    }
  }

  async function handleInvite() {
    if (inviting) return
    if (!passportId) {
      Alert.alert('Save first', 'Save the entry before sending an invite.')
      return
    }
    setInviting(true)
    try {
      const outcome = await sharePassportInvite(passportId, form.fullName.trim() || 'your client', tailorDisplayName)
      const inviteStatus = outcome === 'copied' ? 'LINK_COPIED' : outcome === 'shared' ? 'LINK_SHARED' : null
      if (!inviteStatus) return
      const { error } = await invokeFunction('diary-entry-action', {
        body: { action: inviteStatus === 'LINK_COPIED' ? 'mark-invite-copied' : 'mark-invite-shared', entryId: id },
      })
      if (!error) setInviteStatus(inviteStatus)
      else {
        Sentry.captureException(error, {
          extra: {
            context: 'tailor_diary_record_invite_link_outcome',
            diaryId: id,
            userId: user?.id,
          },
        })
        const message = await readFunctionErrorMessage(
          error,
          'The invite was shared, but we could not update the diary status yet. Reopen this entry and try again.',
        )
        Alert.alert('Invite status not updated', message)
      }
    } finally {
      setInviting(false)
    }
  }

  async function handleDelete() {
    if (deleting) return
    Alert.alert(
      'Delete entry?',
      `This will permanently remove ${form.fullName || 'this client'} from your diary.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            if (deleting) return
            setDeleting(true)
            const { data: attachments, error: attachmentError } = await supabase.from('diary_attachments').select('storage_path').eq('entry_id', id).eq('tailor_id', userId)
            if (attachmentError) { setDeleting(false); Alert.alert('Diary not deleted', 'Private photos could not be checked. Please try again.'); return }
            const paths = (attachments ?? []).map((photo) => photo.storage_path)
            const { error } = await invokeFunction('diary-entry-action', {
              body: { action: 'delete', entryId: id },
            })
            if (error) {
              setDeleting(false)
              Sentry.captureException(error, {
                extra: {
                  context: 'tailor_diary_delete',
                  diaryId: id,
                  userId: user?.id,
                },
              })
              const message = isLikelyConnectivityIssue(error)
                ? 'Connection looks weak. We could not delete this entry yet. Retry when the signal improves.'
                : await readFunctionErrorMessage(error, 'We could not delete this diary entry right now. Please try again in a moment.')
              Alert.alert('Diary not deleted', message)
              return
            }
            if (paths.length) {
              const { error: cleanupError } = await supabase.storage.from('diary-photos').remove(paths)
              if (cleanupError) Sentry.captureException(cleanupError, { extra: { context: 'tailor_diary_photo_cleanup', diaryId: id } })
            }
            goBack()
          },
        },
      ]
    )
  }

  function onDateChange(_event: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS === 'android') setShowDatePicker(false)
    if (selected) set('measuredAt', selected)
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Diary entry</Text>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.stateTitle}>Loading this entry…</Text>
            <Text style={styles.stateHint}>
              We’re pulling together measurements, notes, and invite status so you can continue this client relationship cleanly.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (fetchError && !isNew) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Diary entry</Text>
            <Text style={styles.stateTitle}>Couldn't load this diary entry.</Text>
            <Text style={styles.stateHint}>
              This page should help you carry an offline measurement session into Drapeon without losing fit details or client context.
            </Text>
            <TouchableOpacity style={styles.errorBtn} onPress={() => { void loadEntry() }}>
              <Text style={styles.errorBtnText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.replace('/(tailor)/clients')}>
              <Text style={styles.errorLink}>Open diary</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={goBack}>
              <Text style={styles.errorLink}>Go back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} hitSlop={8}>
            <Feather name="arrow-left" size={22} color={Colors.ink} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{isNew ? 'New client' : form.fullName || 'Edit client'}</Text>
          <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
            {!isNew && (
              <TouchableOpacity onPress={handleDelete} disabled={saving || deleting} hitSlop={8}>
                {deleting
                  ? <ActivityIndicator size="small" color={Colors.error} />
                  : <Feather name="trash-2" size={20} color={Colors.error} />
                }
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={handleSave} disabled={saving || deleting || photoBusy} hitSlop={8} style={styles.saveBtn}>
              {saving
                ? <ActivityIndicator size="small" color={Colors.textInverse} />
                : <Text style={styles.saveBtnText}>{pendingPhotoUploadError ? 'Retry photo upload' : 'Save'}</Text>
              }
            </TouchableOpacity>
          </View>
        </View>

        {showTopError && (
          <View style={styles.topErrorBanner}>
            <Feather name="alert-circle" size={14} color={Colors.error} />
            <Text style={styles.topErrorText}>Please complete required fields before saving</Text>
            <TouchableOpacity onPress={() => setShowTopError(false)} hitSlop={8}>
              <Feather name="x" size={14} color={Colors.error} />
            </TouchableOpacity>
          </View>
        )}

        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.heroCard}>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>Private fitting record</Text>
            </View>
            <Text style={styles.heroTitle}>{isNew ? 'New diary client' : (form.fullName || 'Edit diary client')}</Text>
            <Text style={styles.heroSub}>
              {isNew
                ? 'Record the fitting now. Add more details later, then invite your client to claim their measurements.'
                : 'Keep this client’s measurements and fitting details up to date.'}
            </Text>
          </View>

          {/* ── Client info ─────────────────────────────────────────────── */}
          <View onLayout={(e) => { nameFieldY.current = e.nativeEvent.layout.y }}>
          <Section title="Client info">
            <Field label="Full name *">
              <TextInput
                style={[styles.input, errors.name ? styles.inputError : undefined]}
                value={form.fullName}
                onChangeText={(v) => set('fullName', v)}
                placeholder="e.g. John Doe"
                placeholderTextColor={Colors.midGrey}
                autoCapitalize="words"
              />
              {errors.name && <Text style={styles.errorText}>{errors.name}</Text>}
            </Field>
          </Section>
          </View>

          {/* ── Measurements ────────────────────────────────────────────── */}
          <View onLayout={(e) => { measurementsY.current = e.nativeEvent.layout.y }}>
          <Section title="Measurements">
            <Field label="Unit">
              <SegmentPicker
                options={[{ label: 'cm', value: 'cm' }, { label: 'inches', value: 'in' }]}
                value={form.unit}
                onChange={(v) => set('unit', v as MeasurementUnit)}
              />
            </Field>
            <View style={styles.measureModuleCard}>
              <View style={styles.measureModuleHeader}>
                <View style={styles.measureModuleIcon}>
                  <Feather name="target" size={16} color={Colors.needleGreen} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.measureModuleTitle}>Core body measurements</Text>
                  <Text style={styles.measureModuleSub}>Add at least one to save. Complete the rest when you measure them.</Text>
                </View>
              </View>
              <View style={styles.measureGrid}>
              <MeasureField label="Chest" value={form.chest} unit={form.unit} onChange={(v) => set('chest', v)} />
              <MeasureField label="Shoulder" value={form.shoulder} unit={form.unit} onChange={(v) => set('shoulder', v)} />
              <MeasureField label="Waist" value={form.waist} unit={form.unit} onChange={(v) => set('waist', v)} />
              <MeasureField label="Hip" value={form.hip} unit={form.unit} onChange={(v) => set('hip', v)} />
              </View>
            </View>
            <TouchableOpacity
              style={styles.addModuleRow}
              onPress={() => setMeasurementModuleSheetOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Add measurement module"
            >
              <View>
                <Text style={styles.addModuleTitle}>Add garment detail</Text>
                <Text style={styles.addModuleSub}>Choose lengths, upper body, or lower body fields.</Text>
              </View>
              <Feather name="plus-circle" size={20} color={Colors.needleGreen} />
            </TouchableOpacity>
            {showMeasurementModule('lengths') ? (
              <View style={styles.measureModuleCard}>
                <Text style={styles.measureModuleTitle}>Lengths</Text>
                <View style={styles.measureGrid}>
                  <MeasureField label="Sleeve" value={form.sleeve} unit={form.unit} onChange={(v) => set('sleeve', v)} />
                  <MeasureField label="Trouser length" value={form.trouserLength} unit={form.unit} onChange={(v) => set('trouserLength', v)} />
                  <MeasureField label="Inseam" value={form.inseam} unit={form.unit} onChange={(v) => set('inseam', v)} />
                  <MeasureField label="Back length" value={form.backLength} unit={form.unit} onChange={(v) => set('backLength', v)} />
                </View>
              </View>
            ) : null}
            {showMeasurementModule('upper') ? (
              <View style={styles.measureModuleCard}>
                <Text style={styles.measureModuleTitle}>Upper body detail</Text>
                <View style={styles.measureGrid}>
                  <MeasureField label="Neck" value={form.neck} unit={form.unit} onChange={(v) => set('neck', v)} />
                  <MeasureField label="Bicep" value={form.bicep} unit={form.unit} onChange={(v) => set('bicep', v)} />
                  <MeasureField label="Wrist" value={form.wrist} unit={form.unit} onChange={(v) => set('wrist', v)} />
                  <MeasureField label="Under bust" value={form.underBust} unit={form.unit} onChange={(v) => set('underBust', v)} />
                </View>
              </View>
            ) : null}
            {showMeasurementModule('lower') ? (
              <View style={styles.measureModuleCard}>
                <Text style={styles.measureModuleTitle}>Lower body detail</Text>
                <View style={styles.measureGrid}>
                  <MeasureField label="Thigh" value={form.thigh} unit={form.unit} onChange={(v) => set('thigh', v)} />
                  <MeasureField label="Ankle / cuff" value={form.ankle} unit={form.unit} onChange={(v) => set('ankle', v)} />
                </View>
              </View>
            ) : null}
            {diaryCustomMeasurements.length > 0 ? (
              <View style={styles.measureModuleCard}>
                <View style={styles.measureModuleHeader}>
                  <View style={styles.measureModuleIcon}>
                    <Feather name="aperture" size={16} color={Colors.needleGreen} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.measureModuleTitle}>Custom measurements</Text>
                    <Text style={styles.measureModuleSub}>Extra saved points that do not have a standard diary field.</Text>
                  </View>
                </View>
                <View style={styles.diaryCustomGrid}>
                  {diaryCustomMeasurements.map((measurement) => (
                    <View key={measurement.name} style={styles.diaryCustomPill}>
                      <Text style={styles.diaryCustomLabel}>{measurement.name}</Text>
                      <Text style={styles.diaryCustomValue}>{measurement.value} {form.unit}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
            {errors.measurements && <Text style={styles.errorText}>{errors.measurements}</Text>}
          </Section>
          </View>

          {/* ── Tailor notes ─────────────────────────────────────────────── */}
          <Section title="Tailor notes">
            <Field label="Gender (optional)">
              <SegmentPicker
                options={[
                  { label: 'Male', value: 'MALE' },
                  { label: 'Female', value: 'FEMALE' },
                  { label: 'Prefer not to say', value: 'PREFER_NOT_TO_SAY' },
                ]}
                value={form.gender}
                onChange={(v) => set('gender', v as Gender)}
                nullable
                wrap
              />
            </Field>
            <Field label="Client notes">
              <TextInput
                style={[styles.input, styles.multiline]}
                value={form.clientNotes}
                onChangeText={(v) => set('clientNotes', v)}
                placeholder="Useful fitting context for next time…"
                placeholderTextColor={Colors.midGrey}
                multiline
                numberOfLines={3}
              />
            </Field>
            <Field label="Event type">
              <SegmentPicker
                options={[
                  { label: 'Wedding', value: 'WEDDING' },
                  { label: 'Casual', value: 'CASUAL' },
                  { label: 'Asoebi', value: 'ASOEBI' },
                  { label: 'Formal', value: 'FORMAL' },
                  { label: 'Other', value: 'OTHER' },
                ]}
                value={form.eventType}
                onChange={(v) => set('eventType', v as EventType)}
                nullable
                wrap
              />
            </Field>
            <Field label="Fabric preference">
              <TextInput
                style={styles.input}
                value={form.fabricPreference}
                onChangeText={(v) => set('fabricPreference', v)}
                placeholder="e.g. Ankara, linen, cotton…"
                placeholderTextColor={Colors.midGrey}
              />
            </Field>
            <Field label="Style preference">
              <TextInput
                style={styles.input}
                value={form.stylePreference}
                onChangeText={(v) => set('stylePreference', v)}
                placeholder="e.g. Slim fit, agbada, kaftan…"
                placeholderTextColor={Colors.midGrey}
              />
            </Field>
            <Field label="Fitting notes">
              <TextInput
                style={[styles.input, styles.multiline]}
                value={form.specialFittingNotes}
                onChangeText={(v) => set('specialFittingNotes', v)}
                placeholder="Posture, alterations, special instructions…"
                placeholderTextColor={Colors.midGrey}
                multiline
                numberOfLines={3}
              />
            </Field>
          </Section>

          <Section title="Private fitting photos">
            <Text style={{ color: Colors.midGrey, marginBottom: 12 }}>
              For your diary only. These are not shared in the client invite or public portfolio. Describe them in Fitting notes above.
            </Text>
            {(isNew || savedNewEntryId) ? <>
              <Text style={{ color: Colors.midGrey, marginBottom: 12 }}>Photos are private. They upload when you save this fitting record.</Text>
              <TouchableOpacity style={styles.photoAddButton} onPress={choosePhotoSource} disabled={photoBusy || saving}>
                <Feather name="camera" size={17} color={Colors.needleGreen} />
                <Text style={styles.photoAddText}>{photoBusy ? 'Saving photo…' : pendingPhotos.length ? 'Add another photo' : 'Add photo'}</Text>
              </TouchableOpacity>
              <View style={styles.photoGrid}>
                {photos.map((photo) => <View key={photo.id} style={styles.photoTile}>
                  <Image source={{ uri: photo.url }} style={styles.photoImage} accessibilityLabel="Private fitting photo" />
                </View>)}
                {pendingPhotos.map((photo, index) => <View key={`${photo.uri}-${index}`} style={styles.photoTile}>
                  <Image source={{ uri: photo.uri }} style={styles.photoImage} accessibilityLabel="Selected private fitting photo" />
                  <TouchableOpacity onPress={() => setPendingPhotos((current) => current.filter((_, itemIndex) => itemIndex !== index))} disabled={photoBusy || saving} style={styles.photoRemove} accessibilityLabel="Remove selected fitting photo">
                    <Feather name="trash-2" size={14} color={Colors.inkLight} />
                    <Text style={{ color: Colors.inkLight, marginLeft: 5 }}>Remove</Text>
                  </TouchableOpacity>
                </View>)}
              </View>
            </> : <>
              <TouchableOpacity style={styles.photoAddButton} onPress={choosePhotoSource} disabled={photoBusy || saving}>
                <Feather name="camera" size={17} color={Colors.needleGreen} />
                <Text style={styles.photoAddText}>{photoBusy ? 'Saving photo…' : pendingPhotos.length ? 'Add another photo' : 'Add photo'}</Text>
              </TouchableOpacity>
              {photosLoading ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
              <View style={styles.photoGrid}>
                {photos.map((photo) => <View key={photo.id} style={styles.photoTile}>
                  <Image source={{ uri: photo.url }} style={styles.photoImage} accessibilityLabel="Private fitting photo" />
                  <TouchableOpacity onPress={() => removePhoto(photo)} disabled={photoBusy} style={styles.photoRemove} accessibilityLabel="Remove fitting photo">
                    <Feather name="trash-2" size={14} color={Colors.inkLight} />
                    <Text style={{ color: Colors.inkLight, marginLeft: 5 }}>Remove</Text>
                  </TouchableOpacity>
                </View>)}
                {pendingPhotos.map((photo, index) => <View key={`${photo.uri}-${index}`} style={styles.photoTile}>
                  <Image source={{ uri: photo.uri }} style={styles.photoImage} accessibilityLabel="Selected private fitting photo" />
                  <TouchableOpacity onPress={() => setPendingPhotos((current) => current.filter((_, itemIndex) => itemIndex !== index))} disabled={photoBusy || saving} style={styles.photoRemove} accessibilityLabel="Remove selected fitting photo">
                    <Feather name="trash-2" size={14} color={Colors.inkLight} />
                    <Text style={{ color: Colors.inkLight, marginLeft: 5 }}>Remove</Text>
                  </TouchableOpacity>
                </View>)}
              </View>
            </>}
          </Section>

          {/* ── Session ───────────────────────────────────────────────────── */}
          <Section title="Session">
            <Field label="Date measured">
              <TouchableOpacity
                style={styles.dateBtn}
                onPress={() => setShowDatePicker(true)}
                activeOpacity={0.7}
              >
                <Feather name="calendar" size={16} color={Colors.midGrey} />
                <Text style={[styles.dateBtnText, !form.measuredAt && styles.datePlaceholder]}>
                  {form.measuredAt
                    ? form.measuredAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
                    : 'Select date'}
                </Text>
                {form.measuredAt && (
                  <TouchableOpacity onPress={() => set('measuredAt', null)} hitSlop={8} style={{ marginLeft: 'auto' }}>
                    <Feather name="x" size={14} color={Colors.midGrey} />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            </Field>

            <Field label="Location">
              <SegmentPicker
                options={[
                  { label: 'Shop', value: 'SHOP' },
                  { label: 'Home visit', value: 'CUSTOMER_HOME' },
                  { label: 'Event', value: 'EVENT' },
                ]}
                value={form.measuredLocation}
                onChange={(v) => set('measuredLocation', v as MeasuredLocation)}
              />
            </Field>
          </Section>

          {/* ── Client Passport ──────────────────────────────────────────── */}
          {!isNew && (
            <Section title="Client Passport">
              <View style={styles.passportCard}>
                <View style={styles.passportInfo}>
                  <Feather name="credit-card" size={20} color={Colors.needleGreen} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.passportTitle}>
                      {inviteStatus === 'CLAIMED' ? 'Passport claimed' : 'Share passport'}
                    </Text>
                    <Text style={styles.passportSub}>
                      {inviteStatus === 'CLAIMED'
                        ? 'This client has claimed their measurement passport on Drapeon.'
                        : inviteStatus === 'LINK_COPIED'
                          ? 'Invite link copied. Paste it into a message to send it to your client.'
                          : inviteStatus === 'LINK_SHARED' || inviteStatus === 'INVITE_SENT'
                            ? 'Link shared from your device. Delivery is not confirmed here. The client status updates to Claimed when they accept.'
                          : 'Send this client a link to claim their measurements on Drapeon.'}
                    </Text>
                  </View>
                </View>
                {inviteStatus !== 'CLAIMED' && (
                  <TouchableOpacity
                    style={[styles.inviteBtn, inviting && styles.inviteBtnDisabled]}
                    onPress={() => { void handleInvite() }}
                    disabled={inviting}
                  >
                    {inviting ? (
                      <ActivityIndicator size="small" color={Colors.textInverse} />
                    ) : (
                      <Feather name="send" size={15} color={Colors.textInverse} />
                    )}
                    <Text style={styles.inviteBtnText}>
                      {inviting ? 'Sharing…' : ['LINK_COPIED', 'LINK_SHARED', 'INVITE_SENT'].includes(inviteStatus) ? 'Share again' : 'Share invite'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </Section>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Date Picker ─── */}
      {showDatePicker && Platform.OS === 'android' && (
        <DateTimePicker
          value={form.measuredAt ?? new Date()}
          mode="date"
          display="default"
          maximumDate={new Date()}
          onChange={onDateChange}
        />
      )}
      <ChoiceSheet
        visible={measurementModuleSheetOpen}
        title="Add measurement detail"
        subtitle="Choose the fields this garment or fitting session needs."
        options={DIARY_MEASUREMENT_MODULES}
        selectedValues={visibleMeasurementModules}
        multiple
        doneLabel="Use selected"
        onClose={() => setMeasurementModuleSheetOpen(false)}
        onDone={() => setMeasurementModuleSheetOpen(false)}
        onSelect={(value) => toggleMeasurementModule(value as DiaryMeasurementModuleKey)}
      />
      {showDatePicker && Platform.OS === 'ios' && (
        <Modal transparent animationType="slide" visible={showDatePicker} onRequestClose={() => setShowDatePicker(false)}>
          <View style={styles.dateModalOverlay}>
            <View style={styles.dateModalCard}>
              <View style={styles.dateModalHeader}>
                <Text style={styles.dateModalTitle}>Select date</Text>
                <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                  <Text style={styles.dateModalDone}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={form.measuredAt ?? new Date()}
                mode="date"
                display="spinner"
                maximumDate={new Date()}
                onChange={onDateChange}
                style={{ height: 200 }}
              />
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={sectionStyles.wrap}>
      <Text style={sectionStyles.title}>{title}</Text>
      <View style={sectionStyles.body}>{children}</View>
    </View>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={fieldStyles.wrap}>
      <Text style={fieldStyles.label}>{label}</Text>
      {children}
    </View>
  )
}

function MeasureField({
  label, value, unit, onChange,
}: {
  label: string; value: string; unit: string; onChange: (v: string) => void
}) {
  return (
    <View style={measureStyles.cell}>
      <Text style={measureStyles.label}>{label}</Text>
      <View style={measureStyles.inputRow}>
        <TextInput
          style={measureStyles.input}
          value={value}
          onChangeText={onChange}
          placeholder="0"
          placeholderTextColor={Colors.midGrey}
          keyboardType="decimal-pad"
        />
        <Text style={measureStyles.unit}>{unit}</Text>
      </View>
    </View>
  )
}

function SegmentPicker({
  options, value, onChange, nullable = false, wrap = false,
}: {
  options: { label: string; value: string }[]
  value: string
  onChange: (v: string) => void
  nullable?: boolean
  wrap?: boolean
}) {
  return (
    <View style={[segStyles.row, wrap && segStyles.rowWrap]}>
      {options.map((opt) => {
        const active = value === opt.value
        return (
          <TouchableOpacity
            key={opt.value}
            style={[segStyles.btn, active && segStyles.btnActive]}
            onPress={() => onChange(nullable && active ? '' : opt.value)}
          >
            <Text style={[segStyles.label, active && segStyles.labelActive]}>{opt.label}</Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

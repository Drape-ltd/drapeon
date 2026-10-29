/**
 * Portfolio management screen — add, edit, delete portfolio items.
 * Each item has an image, title, and optional description.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  View, Text, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, Modal, ScrollView,
  Dimensions, StyleSheet,
} from 'react-native'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase, invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { createValidatedUploadPayload, uploadPublicStorageImage } from '@/lib/storage-upload'
import {
  PortfolioVideoPreview,
  RemoteImage,
} from '@/components/ui'
import { Sentry } from '@/lib/sentry'
import {
  launchImagePickerSafely,
  preferCompatibleVideoRepresentation,
} from '@/lib/image-picker-safe'
import {
  pickerVideoContentType as portfolioVideoContentType,
  pickerVideoExtension as portfolioVideoExtension,
  validateVideoPickerAsset,
} from '@/lib/video-asset'
import { Colors } from '@/constants/theme'
import { goBackOrReturnTo, pickSafeReturnTo } from '@/lib/navigation'
import { useContextualBackHandler } from '@/lib/use-contextual-back'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from '@/lib/function-errors'
import { containedImageRect, focalPointInRect } from '@/lib/portfolio-focal-geometry'
import {
  ALLOWED_VIDEO_CONTENT_TYPES,
  MEDIA_CACHE_CONTROL_SECONDS,
  MEDIA_LIMITS_BYTES,
  MEDIA_LIMITS_SECONDS,
  VIDEO_DURATION_LIMIT_MESSAGE,
} from '@drape/shared/media-policy'
import { marketplaceMediaContentPosition, normalizeFocalPoint } from '@drape/shared'
import { styles } from '@/features/tailor-profile/portfolio-styles'
import { PortfolioSortableTile } from '@/features/tailor-setup/PortfolioSortableTile'
import { getPortfolioDropTargetIndex, previewPortfolioGridEntries, portfolioAssetDuplicateKey } from '@/features/tailor-setup/TailorSetupHelpers'
import { MAX_PORTFOLIO_ITEMS, MAX_PORTFOLIO_VIDEOS, MIN_PORTFOLIO_ITEMS } from '@/features/tailor-setup/TailorSetupLimits'

const { width: SCREEN_WIDTH } = Dimensions.get('window')
const TILE_GAP = 12
const TILE_WIDTH = (SCREEN_WIDTH - 32 - TILE_GAP) / 2
const TILE_HEIGHT = TILE_WIDTH * 5 / 4

const MAX_PORTFOLIO_VIDEO_BYTES = MEDIA_LIMITS_BYTES.portfolioVideo
const MAX_PORTFOLIO_VIDEO_SECONDS = MEDIA_LIMITS_SECONDS.portfolioVideo
type PortfolioItem = {
  id: string
  imageUrl: string
  title: string
  description: string | null
  sortOrder: number
  mediaAssetId?: string | null
  focalX?: number
  focalY?: number
}
type PendingItem = { id: string; asset: ImagePicker.ImagePickerAsset; type: 'photo' | 'video'; error?: string }

type EditForm = {
  id: string | null  // null = new
  imageUrl: string
  imageUri: string   // local uri for new uploads
  title: string
  description: string
  mediaAssetId: string | null
  focalX: number
  focalY: number
}

type PortfolioPresentation = {
  id: string
  url: string
  focalX: number
  focalY: number
  portfolioItemId: string | null
}


type TailorPortfolioProfileRow = {
  id: string | null
  portfolio_photo_urls: unknown
  portfolio_video_urls: unknown
}

type PortfolioItemRow = {
  id: string
  image_url: string | null
  title: string | null
  description: string | null
  sort_order: number | null
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  if (typeof value === 'string' && value.length > 0) return [value]
  return []
}

function mapPortfolioItem(row: PortfolioItemRow): PortfolioItem {
  return {
    id: row.id,
    imageUrl: row.image_url ?? '',
    title: row.title ?? '',
    description: row.description ?? null,
    sortOrder: row.sort_order ?? 0,
    focalX: 0.5,
    focalY: 0.5,
  }
}

function validatePortfolioVideoAsset(asset: ImagePicker.ImagePickerAsset) {
  return validateVideoPickerAsset(asset, {
    maxBytes: MAX_PORTFOLIO_VIDEO_BYTES,
    maxSeconds: MAX_PORTFOLIO_VIDEO_SECONDS,
    maxBytesMessage: `Choose portfolio videos under ${Math.round(MAX_PORTFOLIO_VIDEO_BYTES / (1024 * 1024))} MB.`,
    durationMessage: VIDEO_DURATION_LIMIT_MESSAGE,
  })
}

export default function PortfolioScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const params = useLocalSearchParams<{ returnTo?: string; historyChain?: string }>()
  const { user } = useAuth()
  const userId = user?.id ?? null

  const [items, setItems] = useState<PortfolioItem[]>([])
  const [portfolioVideoUrls, setPortfolioVideoUrls] = useState<string[]>([])
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([])
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [videoDragIndex, setVideoDragIndex] = useState<number | null>(null)
  const [videoHoverIndex, setVideoHoverIndex] = useState<number | null>(null)
  const pickedKeys = useRef(new Set<string>())
  const videoUrlsRef = useRef<string[]>([])
  const itemsRef = useRef<PortfolioItem[]>([])
  const [showReorderHint, setShowReorderHint] = useState(true)
  useEffect(() => {
    void AsyncStorage.getItem('drape:portfolio-reorder-hint:v1').then((seen) => {
      if (seen === '1') setShowReorderHint(false)
    })
  }, [])
  function dismissReorderHint() {
    setShowReorderHint(false)
    void AsyncStorage.setItem('drape:portfolio-reorder-hint:v1', '1')
  }
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const [tailorProfileId, setTailorProfileId] = useState<string | null>(null)
  const [editModal, setEditModal] = useState<EditForm | null>(null)
  const [cropBox, setCropBox] = useState({ width: 1, height: 1 })
  const [previewImageSize, setPreviewImageSize] = useState<{ uri: string; width: number; height: number } | null>(null)
  const previewUri = editModal?.imageUri || editModal?.imageUrl || ''
  const displayedImageRect = previewImageSize?.uri === previewUri
    ? containedImageRect(cropBox, previewImageSize)
    : null
  const [cropLoading, setCropLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [coverSavingId, setCoverSavingId] = useState<string | null>(null)
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)
  const [expandedViewerIndex, setExpandedViewerIndex] = useState(0)
  const [activePortfolioVideoIndex, setActivePortfolioVideoIndex] = useState<number | null>(null)

  const loadData = useCallback(async () => {
    if (!userId) {
      setLoading(false)
      setFetchError(false)
      setItems([])
      setPortfolioVideoUrls([])
      setTailorProfileId(null)
      return
    }
    setFetchError(false)
    try {
      const profileRes = await supabase
        .from('tailor_profiles')
        .select('id, portfolio_photo_urls, portfolio_video_urls')
        .eq('user_id', userId)
        .maybeSingle()
      if (profileRes.error) throw profileRes.error
      const profileRow = profileRes.data as TailorPortfolioProfileRow | null
      const pid = profileRow?.id ?? null
      const setupPhotoUrls = asStringList(profileRow?.portfolio_photo_urls)
      setPortfolioVideoUrls(asStringList(profileRow?.portfolio_video_urls))
      videoUrlsRef.current = asStringList(profileRow?.portfolio_video_urls)
      setTailorProfileId(pid)
      if (!pid) { itemsRef.current = []; setItems([]); setLoading(false); return }

      const { data, error } = await supabase
        .from('portfolio_items')
        .select('id, image_url, title, description, sort_order')
        .eq('tailor_profile_id', pid)
        .order('sort_order', { ascending: true })
      if (error) throw error

      const existing = ((data ?? []) as PortfolioItemRow[]).map(mapPortfolioItem)

      let finalItems = existing

      const allBlank = existing.length > 0 && existing.every((i) => !i.imageUrl)
      if (allBlank) {
        finalItems = []
      }
      if ((existing.length === 0 || allBlank) && setupPhotoUrls.length > 0) {
        const { error: seedError } = await invokeFunction('portfolio-item-action', {
          body: { action: 'seed-from-setup', photoUrls: setupPhotoUrls },
        })
        if (seedError) throw seedError
        const { data: seeded } = await supabase
          .from('portfolio_items')
          .select('id, image_url, title, description, sort_order')
          .eq('tailor_profile_id', pid)
          .order('sort_order', { ascending: true })
        finalItems = ((seeded ?? []) as PortfolioItemRow[]).map(mapPortfolioItem)
      }

      // Presentation metadata is the shared source of truth for web and app crops.
      // Keep this read-only so opening the editor never triggers moderation reconciliation.
      const { data: presentationData, error: presentationError } = await invokeFunction<{
        media?: PortfolioPresentation[]
      }>('tailor-profile-action', { body: { action: 'get-media-presentation', reconcile: false } })
      if (presentationError) {
        Sentry.captureException(presentationError, { tags: { surface: 'tailor_portfolio_presentation_load' } })
      } else if (presentationData?.media) {
        finalItems = finalItems.map((item) => {
          const media = presentationData.media?.find((candidate) => candidate.portfolioItemId === item.id)
            ?? presentationData.media?.find((candidate) => candidate.url.split(/[?#]/u)[0] === item.imageUrl.split(/[?#]/u)[0])
          return media ? {
            ...item,
            mediaAssetId: media.id,
            focalX: normalizeFocalPoint(media.focalX),
            focalY: normalizeFocalPoint(media.focalY),
          } : item
        })
      }

      setItems(finalItems)
      itemsRef.current = finalItems
    } catch {
      setFetchError(true)
      setItems([])
      setPortfolioVideoUrls([])
      setTailorProfileId(null)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadData()
    }, 0)
    return () => clearTimeout(timer)
  }, [loadData])

  function openAddPicker() {
    Alert.alert('Add to portfolio', undefined, [
      { text: 'Choose from library', onPress: () => void pickMedia('library') },
      { text: 'Take photo', onPress: () => void pickMedia('camera-photo') },
      { text: 'Record video', onPress: () => void pickMedia('camera-video') },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  async function pickMedia(source: 'library' | 'camera-photo' | 'camera-video') {
    const permission = source === 'library'
      ? await ImagePicker.requestMediaLibraryPermissionsAsync()
      : await ImagePicker.requestCameraPermissionsAsync()
    if (!permission.granted) {
      Alert.alert('Permission needed', source === 'library'
        ? 'Allow photo library access to add your work.'
        : 'Allow camera access to add your work.')
      return
    }
    const photoSlots = MAX_PORTFOLIO_ITEMS - itemsRef.current.length - pendingItems.filter((item) => item.type === 'photo').length
    const videoSlots = MAX_PORTFOLIO_VIDEOS - videoUrlsRef.current.length - pendingItems.filter((item) => item.type === 'video').length
    if (source === 'camera-photo' && photoSlots <= 0 || source === 'camera-video' && videoSlots <= 0 || source === 'library' && photoSlots + videoSlots <= 0) {
      Alert.alert('Portfolio full', 'Remove a piece to add another.')
      return
    }
    const options = source === 'library'
      ? preferCompatibleVideoRepresentation({ mediaTypes: ['images', 'videos'] as ImagePicker.MediaType[], allowsMultipleSelection: true, orderedSelection: true, selectionLimit: photoSlots + videoSlots, allowsEditing: false, quality: 0.85 })
      : { mediaTypes: (source === 'camera-photo' ? 'images' : 'videos') as 'images' | 'videos', allowsEditing: false, quality: 0.85, videoMaxDuration: MAX_PORTFOLIO_VIDEO_SECONDS }
    const result = await launchImagePickerSafely(
      () => source === 'library' ? ImagePicker.launchImageLibraryAsync(options) : ImagePicker.launchCameraAsync(options),
      { context: 'tailor_portfolio_media_picker', mediaLabel: 'portfolio media', extra: { source, userId } },
    )
    if (!result || result.canceled) return
    let remainingPhotos = photoSlots
    let remainingVideos = videoSlots
    const accepted: PendingItem[] = []
    for (const asset of result.assets) {
      const type = asset.type === 'video' ? 'video' : 'photo'
      const key = portfolioAssetDuplicateKey(asset)
      if (pickedKeys.current.has(key)) continue
      if (type === 'photo' && remainingPhotos <= 0 || type === 'video' && remainingVideos <= 0) continue
      if (type === 'video') {
        const message = validatePortfolioVideoAsset(asset)
        if (message) { Alert.alert('Video not added', message); continue }
        remainingVideos--
      } else remainingPhotos--
      pickedKeys.current.add(key)
      accepted.push({ id: `${Date.now()}-${accepted.length}`, asset, type })
    }
    if (!accepted.length) return
    setPendingItems((current) => [...current, ...accepted])
    // Keep the picker out of the upload path; every selected item gets a visible tile now.
    void uploadSelected(accepted)
  }

  async function uploadImage(uri: string): Promise<string> {
    if (!userId) throw new Error('Sign in to upload your portfolio.')
    const compressed = await ImageManipulator.manipulateAsync(
      uri, [{ resize: { width: 800 } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
    )
    const fileName = `portfolio/${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
    const uploaded = await uploadPublicStorageImage({
      bucket: 'portfolio-photos', path: fileName, uri: compressed.uri,
      contentType: 'image/jpeg', maxBytes: 10 * 1024 * 1024,
    })
    if (!uploaded) throw new Error('Photo upload failed.')
    return uploaded
  }

  async function uploadSelected(selected: PendingItem[]) {
    for (const pending of selected) {
      try {
        if (pending.type === 'photo') {
          const imageUrl = await uploadImage(pending.asset.uri)
          const { data, error } = await invokeFunction<{ itemId?: string }>('portfolio-item-action', {
            body: { action: 'create-item', item: { imageUrl, title: '', description: null, category: null } },
          })
          if (error || !data?.itemId) throw error ?? new Error('Could not save the photo.')
          const next = [...itemsRef.current, { id: data.itemId, imageUrl, title: '', description: null, sortOrder: itemsRef.current.length, focalX: 0.5, focalY: 0.5 }]
          itemsRef.current = next
          setItems(next)
        } else {
          if (!userId) throw new Error('Sign in to upload your portfolio.')
          const contentType = portfolioVideoContentType(pending.asset)
          const extension = portfolioVideoExtension(pending.asset)
          const payload = await createValidatedUploadPayload(pending.asset.uri, {
            maxBytes: MAX_PORTFOLIO_VIDEO_BYTES, contentType,
            allowedContentTypes: ALLOWED_VIDEO_CONTENT_TYPES, purpose: 'PORTFOLIO',
          })
          const filename = `portfolio/${userId}/videos/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`
          const { error: uploadError } = await supabase.storage.from('portfolio-photos').upload(filename, payload.data, {
            contentType, cacheControl: MEDIA_CACHE_CONTROL_SECONDS.publicImmutable,
          })
          if (uploadError) throw uploadError
          const url = supabase.storage.from('portfolio-photos').getPublicUrl(filename).data.publicUrl
          const next = [...videoUrlsRef.current, url]
          const { error } = await invokeFunction('tailor-profile-action', {
            body: { action: 'update-portfolio-videos', videoUrls: next },
          })
          if (error) throw error
          videoUrlsRef.current = next
          setPortfolioVideoUrls(next)
        }
        setPendingItems((current) => current.filter((item) => item.id !== pending.id))
      } catch (error) {
        Sentry.captureException(error, { tags: { surface: 'tailor_portfolio_background_upload' } })
        setPendingItems((current) => current.map((item) => item.id === pending.id ? { ...item, error: 'Upload failed' } : item))
      }
    }
  }

  function removePending(id: string) {
    setPendingItems((current) => {
      const match = current.find((item) => item.id === id)
      if (match) pickedKeys.current.delete(portfolioAssetDuplicateKey(match.asset))
      return current.filter((item) => item.id !== id)
    })
  }

  async function removePortfolioVideo(videoUrl: string) {
    if (items.length + portfolioVideoUrls.length <= MIN_PORTFOLIO_ITEMS) {
      Alert.alert('Keep one piece', 'Your portfolio needs at least one photo or video.')
      return
    }
    Alert.alert('Delete video?', 'Remove this video from your portfolio?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void (async () => {
        const next = videoUrlsRef.current.filter((url) => url !== videoUrl)
        const { error } = await invokeFunction('tailor-profile-action', {
          body: { action: 'update-portfolio-videos', videoUrls: next },
        })
        if (error) { Alert.alert('Could not remove video', 'Try again.'); return }
        videoUrlsRef.current = next
        setPortfolioVideoUrls(next)
        setActivePortfolioVideoIndex(null)
      })() },
    ])
  }

  function openEdit(item: PortfolioItem) {
    setEditModal({
      id: item.id,
      imageUrl: item.imageUrl,
      imageUri: '',
      title: item.title,
      description: item.description ?? '',
      mediaAssetId: item.mediaAssetId ?? null,
      focalX: item.focalX ?? 0.5,
      focalY: item.focalY ?? 0.5,
    })
    setCropLoading(true)
    void invokeFunction<{ media?: PortfolioPresentation[] }>('tailor-profile-action', {
      body: { action: 'get-media-presentation', reconcile: false },
    }).then(({ data, error }) => {
      if (error) throw error
      const presentation = data?.media?.find((media) => media.portfolioItemId === item.id)
        ?? data?.media?.find((media) => media.url.split(/[?#]/u)[0] === item.imageUrl.split(/[?#]/u)[0])
      if (!presentation) return
      setItems((current) => current.map((candidate) => candidate.id === item.id
        ? { ...candidate, mediaAssetId: presentation.id, focalX: normalizeFocalPoint(presentation.focalX), focalY: normalizeFocalPoint(presentation.focalY) }
        : candidate))
      setEditModal((current) => current?.id === item.id
        ? { ...current, mediaAssetId: presentation.id, focalX: normalizeFocalPoint(presentation.focalX), focalY: normalizeFocalPoint(presentation.focalY) }
        : current)
    }).catch((error) => {
      Sentry.captureException(error, { tags: { surface: 'tailor_portfolio_focal_point' } })
    }).finally(() => setCropLoading(false))
  }

  function updateFocalPoint(event: { nativeEvent: { locationX: number; locationY: number } }) {
    const locationX = event.nativeEvent?.locationX
    const locationY = event.nativeEvent?.locationY
    if (typeof locationX !== 'number' || typeof locationY !== 'number' || !displayedImageRect) return
    const nextFocal = focalPointInRect(locationX, locationY, displayedImageRect)
    setEditModal((current) => current ? {
      ...current,
      ...nextFocal,
    } : current)
  }

  function goBack() {
    goBackOrReturnTo(router, navigation, pickSafeReturnTo(params.historyChain, params.returnTo), '/(tailor)/profile')
  }

  useContextualBackHandler(goBack)

  async function handleSave() {
    if (!editModal) return
    if (!editModal.imageUrl && !editModal.imageUri) {
      Alert.alert('Image required', 'Please select an image.')
      return
    }
    if (!tailorProfileId) {
      Alert.alert('Profile required', 'Complete your tailor profile first.')
      return
    }

    setSaving(true)
    let finalImageUrl = editModal.imageUrl
    if (editModal.imageUri) {
      try {
        finalImageUrl = await uploadImage(editModal.imageUri)
      } catch {
        Alert.alert('Upload failed', 'Could not upload image. Please try again.')
        setSaving(false)
        return
      }
    }

    let error: Error | null = null
    let savedItemId = editModal.id
    if (editModal.id) {
      const res = await invokeFunction<{ itemId?: string }>('portfolio-item-action', {
        body: {
          action: 'update-item',
          itemId: editModal.id,
          item: {
            imageUrl: finalImageUrl!,
            title: editModal.title.trim(),
            description: editModal.description.trim() || null,
            category: null,
          },
        },
      })
      error = res.error
      savedItemId = res.data?.itemId ?? savedItemId
    } else {
      const res = await invokeFunction<{ itemId?: string }>('portfolio-item-action', {
        body: {
          action: 'create-item',
          item: {
            imageUrl: finalImageUrl!,
            title: editModal.title.trim(),
            description: editModal.description.trim() || null,
            category: null,
          },
        },
      })
      error = res.error
      savedItemId = res.data?.itemId ?? savedItemId
    }

    if (error) {
      setSaving(false)
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not save this portfolio item yet. Your details are still here, so retry when the signal improves.'
        : await readFunctionErrorMessage(error, 'We could not save this portfolio item right now. Please try again.')
      Alert.alert('Save failed', message)
      return
    }
    if (editModal.mediaAssetId) {
      const { error: presentationError } = await invokeFunction('tailor-profile-action', {
        body: {
          action: 'update-media-presentation',
          mediaAssetId: editModal.mediaAssetId,
          focalX: editModal.focalX,
          focalY: editModal.focalY,
          isPrimary: items[0]?.id === editModal.id,
        },
      })
      if (presentationError) {
        setSaving(false)
        Alert.alert('Portfolio details saved', 'Your title and description were saved, but the image crop was not. Reopen this item and save again to retry the crop.')
        return
      }
      setItems((current) => current.map((item) => item.id === editModal.id
        ? { ...item, mediaAssetId: editModal.mediaAssetId, focalX: editModal.focalX, focalY: editModal.focalY }
        : item))
    }
    if (!editModal.mediaAssetId && savedItemId && (editModal.focalX !== 0.5 || editModal.focalY !== 0.5)) {
      const { data, error: lookupError } = await invokeFunction<{ media?: PortfolioPresentation[] }>(
        'tailor-profile-action', { body: { action: 'get-media-presentation', reconcile: false } },
      )
      const presentation = !lookupError
        ? data?.media?.find((media) => media.portfolioItemId === savedItemId)
          ?? data?.media?.find((media) => media.url.split(/[?#]/u)[0] === finalImageUrl.split(/[?#]/u)[0])
        : undefined
      if (presentation) {
        const { error: presentationError } = await invokeFunction('tailor-profile-action', {
          body: {
            action: 'update-media-presentation',
            mediaAssetId: presentation.id,
            focalX: editModal.focalX,
            focalY: editModal.focalY,
            isPrimary: items[0]?.id === savedItemId,
          },
        })
        if (presentationError) {
          setSaving(false)
          Alert.alert('Portfolio details saved', 'Your title and description were saved, but the image crop was not. Reopen this item and save again to retry the crop.')
          return
        }
        setItems((current) => current.map((item) => item.id === savedItemId
          ? { ...item, mediaAssetId: presentation.id, focalX: editModal.focalX, focalY: editModal.focalY }
          : item))
      } else if (lookupError) {
        Sentry.captureException(lookupError, { tags: { surface: 'tailor_portfolio_focal_point_lookup' } })
        setSaving(false)
        Alert.alert('Portfolio details saved', 'Your title and description were saved, but we could not load the crop settings. Reopen this item and try again when you are back online.')
        return
      } else {
        setSaving(false)
        Alert.alert('Portfolio details saved', 'Your title and description were saved, but this photo is not ready for crop positioning yet. Try again in a moment.')
        return
      }
    }
    setSaving(false)
    setEditModal(null)
    void loadData()
  }

  async function makeExploreCover(item: PortfolioItem) {
    if (coverSavingId || items[0]?.id === item.id) return
    setCoverSavingId(item.id)
    const { error } = await invokeFunction('portfolio-item-action', {
      body: { action: 'set-cover', itemId: item.id },
    })
    if (error) {
      setCoverSavingId(null)
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not update your Explore cover yet. Try again when the signal improves.'
        : await readFunctionErrorMessage(error, 'Could not update your Explore cover right now.')
      Alert.alert('Cover not updated', message)
      return
    }

    const nextItems = [item, ...items.filter((candidate) => candidate.id !== item.id)]
      .map((candidate, index) => ({ ...candidate, sortOrder: index }))
    setItems(nextItems)
    itemsRef.current = nextItems
    setCoverSavingId(null)
  }

  async function handleDelete(item: PortfolioItem) {
    if (deletingId) return
    if (items.length + portfolioVideoUrls.length <= MIN_PORTFOLIO_ITEMS) {
      Alert.alert('Keep one piece', 'Your portfolio needs at least one photo or video.')
      return
    }
    Alert.alert(
      'Delete item?',
      'Remove this photo from your portfolio?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            if (deletingId) return
            setDeletingId(item.id)
            const { error } = await invokeFunction('portfolio-item-action', {
              body: { action: 'delete-item', itemId: item.id },
            })
            if (error) {
              setDeletingId(null)
              const message = isLikelyConnectivityIssue(error)
                ? 'Connection looks weak. We could not delete this portfolio item yet. Try again when the signal improves.'
                : await readFunctionErrorMessage(error, 'We could not delete this portfolio item right now.')
              Alert.alert('Delete failed', message)
              return
            }
            const nextItems = items.filter((i) => i.id !== item.id)
            setItems(nextItems)
            itemsRef.current = nextItems
            setDeletingId(null)
          },
        },
      ]
    )
  }

  const photoPreview = previewPortfolioGridEntries(
    items.map((item) => ({ type: 'photo' as const, url: item.imageUrl })),
    dragIndex, hoverIndex,
  ).map((entry) => items[entry.originalIndex])
  const videoPreview = previewPortfolioGridEntries(
    portfolioVideoUrls.map((url) => ({ type: 'video' as const, url })),
    videoDragIndex, videoHoverIndex,
  ).map((entry) => ({ url: entry.item.url, originalIndex: entry.originalIndex }))
  const visible = [
    ...(items.length < MAX_PORTFOLIO_ITEMS || portfolioVideoUrls.length < MAX_PORTFOLIO_VIDEOS ? [{ type: 'add' as const, id: 'add' }] : []),
    ...photoPreview.map((item) => ({ type: 'photo' as const, id: item.id, item })),
    ...pendingItems.map((item) => ({ type: 'pending' as const, id: item.id, item })),
    ...videoPreview.map(({ url, originalIndex }) => ({ type: 'video' as const, id: url, url, index: originalIndex })),
  ]

  async function finishPhotoDrag(from: number, dx: number, dy: number) {
    const target = getPortfolioDropTargetIndex(from, dx, dy, items.length, {
      columns: 2, cellWidth: TILE_WIDTH + TILE_GAP, cellHeight: TILE_HEIGHT + TILE_GAP,
    })
    setDragIndex(null)
    setHoverIndex(null)
    if (target == null || target === from) return
    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(target, 0, moved)
    setItems(next)
    itemsRef.current = next
    const { error } = await invokeFunction('portfolio-item-action', {
      body: { action: 'reorder-items', itemIds: next.map((item) => item.id) },
    })
    if (error) { setItems(items); itemsRef.current = items; Alert.alert('Could not reorder', 'Try again.') }
  }
  async function finishVideoDrag(from: number, dx: number, dy: number) {
    const target = getPortfolioDropTargetIndex(from, dx, dy, portfolioVideoUrls.length, {
      columns: 2, cellWidth: TILE_WIDTH + TILE_GAP, cellHeight: TILE_HEIGHT + TILE_GAP,
    })
    setVideoDragIndex(null)
    setVideoHoverIndex(null)
    if (target == null || target === from) return
    const next = [...portfolioVideoUrls]
    const [moved] = next.splice(from, 1)
    next.splice(target, 0, moved)
    setPortfolioVideoUrls(next)
    videoUrlsRef.current = next
    const { error } = await invokeFunction('tailor-profile-action', {
      body: { action: 'update-portfolio-videos', videoUrls: next },
    })
    if (error) { setPortfolioVideoUrls(portfolioVideoUrls); videoUrlsRef.current = portfolioVideoUrls; Alert.alert('Could not reorder', 'Try again.') }
  }

  if (loading) {
    return <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}><Text style={styles.headerTitle}>Portfolio</Text></View>
      <View style={screenStyles.skeletonGrid}>{[0, 1, 2, 3].map((index) => <View key={index} style={screenStyles.skeleton} />)}</View>
    </SafeAreaView>
  }
  if (fetchError) {
    return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.stateWrap}>
        <Text style={styles.stateTitle}>Couldn't load your portfolio.</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Try loading portfolio again" style={styles.retryBtn} onPress={() => { setLoading(true); void loadData() }}>
          <Text style={styles.retryBtnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={screenStyles.header}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" onPress={goBack} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={screenStyles.title}>Portfolio</Text>
          <Text style={screenStyles.counter}>{items.length} of {MAX_PORTFOLIO_ITEMS} photos · {portfolioVideoUrls.length} of {MAX_PORTFOLIO_VIDEOS} videos</Text>
        </View>
      </View>
      <FlatList
        style={styles.list}
        data={visible}
        keyExtractor={(entry) => entry.id}
        numColumns={2}
        scrollEnabled={dragIndex === null && videoDragIndex === null}
        columnWrapperStyle={screenStyles.row}
        contentContainerStyle={screenStyles.grid}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={items.length + portfolioVideoUrls.length === 0
          ? <Text style={screenStyles.hint}>Add clear photos of finished pieces. Front, back and close-ups work best.</Text>
          : showReorderHint ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Dismiss reorder hint" onPress={dismissReorderHint}><Text style={screenStyles.hint}>Hold and drag to reorder. Your first photo is your Explore cover.</Text></TouchableOpacity> : null}
        renderItem={({ item: entry }) => {
          if (entry.type === 'add') return <TouchableOpacity
            style={screenStyles.addTile} onPress={openAddPicker} accessibilityRole="button" accessibilityLabel="Add photos or videos">
            <Feather name="plus" size={30} color={Colors.needleGreen} />
            <Text style={screenStyles.addText}>Add photos or videos</Text>
          </TouchableOpacity>
          if (entry.type === 'pending') return <View style={screenStyles.tile}>
            {entry.item.type === 'photo'
              ? <RemoteImage uri={entry.item.asset.uri} style={screenStyles.image} contentFit="cover" surface="tailor_portfolio_pending" />
              : <PortfolioVideoPreview uri={entry.item.asset.uri} style={screenStyles.image} autoplay={false} />}
            <View style={screenStyles.pendingOverlay}>
              {entry.item.error ? <>
                <Text style={screenStyles.overlayText}>Upload failed</Text>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry upload" onPress={() => { setPendingItems((current) => current.map((item) => item.id === entry.id ? { ...item, error: undefined } : item)); void uploadSelected([entry.item]) }}><Text style={screenStyles.overlayText}>Retry</Text></TouchableOpacity>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Remove failed upload" onPress={() => removePending(entry.id)}><Text style={screenStyles.overlayText}>Remove</Text></TouchableOpacity>
              </> : <><ActivityIndicator color={Colors.textInverse} /><Text style={screenStyles.overlayText}>Uploading…</Text></>}
            </View>
          </View>
          if (entry.type === 'video') return <PortfolioSortableTile
            item={{ type: 'video', url: entry.url }} index={entry.index} isCover={false}
            dragging={videoDragIndex === entry.index} width={TILE_WIDTH} height={TILE_HEIGHT} hideRemove
            onOpen={() => setActivePortfolioVideoIndex(entry.index)} onDelete={() => void removePortfolioVideo(entry.url)}
            onDragStart={() => { setVideoDragIndex(entry.index); setVideoHoverIndex(entry.index); dismissReorderHint() }}
            onDragMove={(dx, dy) => setVideoHoverIndex(getPortfolioDropTargetIndex(entry.index, dx, dy, portfolioVideoUrls.length, { columns: 2, cellWidth: TILE_WIDTH + TILE_GAP, cellHeight: TILE_HEIGHT + TILE_GAP }))}
            onDragEnd={(dx, dy) => { void finishVideoDrag(entry.index, dx, dy) }}
          />
          const index = items.findIndex((item) => item.id === entry.id)
          const visualIndex = photoPreview.findIndex((item) => item.id === entry.id)
          return <PortfolioSortableTile
            item={{ type: 'photo', url: entry.item.imageUrl }} index={index} isCover={visualIndex === 0}
            dragging={dragIndex === index} width={TILE_WIDTH} height={TILE_HEIGHT} hideRemove
            focalX={entry.item.focalX} focalY={entry.item.focalY}
            onOpen={() => { setExpandedIndex(index); setExpandedViewerIndex(index) }}
            onDelete={() => void handleDelete(entry.item)}
            onDragStart={() => { setDragIndex(index); setHoverIndex(index); dismissReorderHint() }}
            onDragMove={(dx, dy) => setHoverIndex(getPortfolioDropTargetIndex(index, dx, dy, items.length, { columns: 2, cellWidth: TILE_WIDTH + TILE_GAP, cellHeight: TILE_HEIGHT + TILE_GAP }))}
            onDragEnd={(dx, dy) => { void finishPhotoDrag(index, dx, dy) }}
          />
        }}
      />

      {/* ── Edit / Add modal ── */}
      {editModal && (
        <Modal animationType="slide" presentationStyle="pageSheet" visible onRequestClose={() => setEditModal(null)}>
          <SafeAreaView style={styles.modalSafe} edges={['top', 'bottom']}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setEditModal(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close edit piece">
                <Feather name="x" size={22} color={Colors.ink} />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Edit piece</Text>
              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.5 }]}
                onPress={handleSave}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel="Save piece"
              >
                {saving
                  ? <ActivityIndicator size="small" color={Colors.textInverse} />
                  : <Text style={styles.saveBtnText}>Save</Text>
                }
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
              {/* Image picker */}
              <View
                style={styles.imagePicker}
                onLayout={(event) => setCropBox({
                  width: Math.max(1, event.nativeEvent.layout.width),
                  height: Math.max(1, event.nativeEvent.layout.height),
                })}
                onStartShouldSetResponder={() => !!(editModal.imageUri || editModal.imageUrl)}
                onMoveShouldSetResponder={() => !!(editModal.imageUri || editModal.imageUrl)}
                onResponderGrant={updateFocalPoint}
                onResponderMove={updateFocalPoint}
              >
                {(editModal.imageUri || editModal.imageUrl) ? (
                  <RemoteImage
                    uri={editModal.imageUri || editModal.imageUrl}
                    bucket={editModal.imageUri ? undefined : 'portfolio-photos'}
                    style={styles.imagePickerImg}
                    contentFit="contain"
                    contentPosition="center"
                    onLoad={({ source }) => setPreviewImageSize({ uri: previewUri, width: source.width, height: source.height })}
                    transition={120}
                    surface="tailor_portfolio_editor_preview"
                  />
                ) : (
                  <View style={styles.imagePickerEmpty}>
                    <Feather name="image" size={32} color={Colors.midGrey} />
                    <Text style={styles.imagePickerText}>Tap to add photo</Text>
                  </View>
                )}
                {(editModal.imageUri || editModal.imageUrl) && displayedImageRect ? (
                  <View pointerEvents="none" style={[
                    styles.focalMarker,
                    { left: displayedImageRect.left + editModal.focalX * displayedImageRect.width,
                      top: displayedImageRect.top + editModal.focalY * displayedImageRect.height },
                  ]}>
                    <View style={styles.focalMarkerDot} />
                  </View>
                ) : null}
                {cropLoading ? (
                  <View style={styles.cropLoading}><ActivityIndicator size="small" color={Colors.textInverse} /></View>
                ) : null}
              </View>
              {(editModal.imageUri || editModal.imageUrl) ? (
                <View style={styles.cropHintRow}>
                  <Text style={styles.cropHint}>Drag the marker to choose what shows in your grid. Customers see the full photo when they tap.</Text>
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel="Reset photo focal point" onPress={() => setEditModal((current) => current ? { ...current, focalX: 0.5, focalY: 0.5 } : current)}>
                    <Text style={styles.cropReset}>Reset</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              <View style={screenStyles.previewRow}>
                <RemoteImage
                  uri={editModal.imageUrl}
                  bucket="portfolio-photos"
                  style={screenStyles.previewTile}
                  contentFit="cover"
                  contentPosition={marketplaceMediaContentPosition({ focalX: editModal.focalX, focalY: editModal.focalY })}
                  surface="tailor_portfolio_grid_preview"
                />
                <Text style={screenStyles.previewCaption}>How it looks in your grid</Text>
              </View>

              {/* Title */}
              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>Name this piece (optional)</Text>
                <TextInput
                  style={styles.input}
                  value={editModal.title}
                  onChangeText={(v) => setEditModal((m) => m ? { ...m, title: v } : m)}
                  placeholder="e.g. Wedding Agbada"
                  placeholderTextColor={Colors.midGrey}
                  autoCapitalize="words"
                  accessibilityLabel="Name this piece, optional"
                />
              </View>

              {/* Description */}
              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>Details (fabric, occasion)</Text>
                <TextInput
                  style={[styles.input, styles.multiline]}
                  value={editModal.description}
                  onChangeText={(v) => setEditModal((m) => m ? { ...m, description: v } : m)}
                  placeholder="Fabric, occasion, or anything notable…"
                  placeholderTextColor={Colors.midGrey}
                  multiline
                  numberOfLines={3}
                  accessibilityLabel="Details, fabric and occasion, optional"
                />
              </View>

            </ScrollView>
          </SafeAreaView>
        </Modal>
      )}

      {/* ── Full image expand ── */}
      {expandedIndex !== null && items.length > 0 && (
        <Modal transparent animationType="fade" visible onRequestClose={() => setExpandedIndex(null)}>
          <View style={styles.expandOverlay}>
            <FlatList
              key={`portfolio-expanded-${expandedIndex}`}
              data={items}
              horizontal
              pagingEnabled
              initialScrollIndex={Math.min(expandedIndex, Math.max(items.length - 1, 0))}
              getItemLayout={(_, index) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * index, index })}
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(event) => {
                const nextIndex = Math.round(event.nativeEvent.contentOffset.x / SCREEN_WIDTH)
                setExpandedViewerIndex(nextIndex)
              }}
              renderItem={({ item }) => (
                <View style={styles.expandedSlide}>
                  <RemoteImage
                    uri={item.imageUrl}
                    bucket="portfolio-photos"
                    style={styles.expandedImage}
                    contentFit="contain"
                    transition={150}
                    surface="tailor_portfolio_expanded"
                  />
                </View>
              )}
            />
            {items.length > 1 ? (
              <View style={styles.expandedCount}>
                <Text style={styles.expandedCountText}>
                  {expandedViewerIndex + 1} / {items.length}
                </Text>
              </View>
            ) : null}
            <TouchableOpacity style={styles.expandClose} onPress={() => setExpandedIndex(null)} accessibilityRole="button" accessibilityLabel="Close photo viewer">
              <Feather name="x" size={20} color={Colors.textInverse} />
            </TouchableOpacity>
            <View style={screenStyles.viewerBar}>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Edit photo" onPress={() => { const item = items[expandedViewerIndex]; setExpandedIndex(null); if (item) openEdit(item) }}>
                <Text style={screenStyles.viewerAction}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Set as Explore cover" onPress={() => { const item = items[expandedViewerIndex]; if (item) void makeExploreCover(item) }}>
                <Text style={screenStyles.viewerAction}>Set as cover</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Delete photo" onPress={() => { const item = items[expandedViewerIndex]; setExpandedIndex(null); if (item) void handleDelete(item) }}>
                <Text style={screenStyles.viewerAction}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {activePortfolioVideoIndex !== null && portfolioVideoUrls[activePortfolioVideoIndex] ? (
        <Modal visible animationType="fade" onRequestClose={() => setActivePortfolioVideoIndex(null)}>
          <View style={styles.expandOverlay}>
            <PortfolioVideoPreview uri={portfolioVideoUrls[activePortfolioVideoIndex]} style={{ width: SCREEN_WIDTH, height: '85%' }} contentFit="contain" nativeControls autoplay isLooping={false} />
            <TouchableOpacity style={styles.expandClose} accessibilityRole="button" accessibilityLabel="Close video" onPress={() => setActivePortfolioVideoIndex(null)}><Feather name="x" size={20} color={Colors.textInverse} /></TouchableOpacity>
            <View style={screenStyles.viewerBar}>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Delete video" onPress={() => { const url = portfolioVideoUrls[activePortfolioVideoIndex]; if (url) void removePortfolioVideo(url) }}>
                <Text style={screenStyles.viewerAction}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      ) : null}
    </SafeAreaView>
  )
}

const screenStyles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, paddingVertical: 12 },
  title: { color: Colors.ink, fontSize: 24, fontWeight: '600' },
  counter: { color: Colors.inkLight, fontSize: 12, marginTop: 2 },
  grid: { paddingHorizontal: 16, paddingBottom: 40, gap: TILE_GAP },
  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: TILE_GAP, paddingHorizontal: 16 },
  row: { gap: TILE_GAP },
  tile: { width: TILE_WIDTH, height: TILE_HEIGHT, borderRadius: 12, overflow: 'hidden', backgroundColor: Colors.boneDeep },
  image: { width: TILE_WIDTH, height: TILE_HEIGHT },
  addTile: { width: TILE_WIDTH, height: TILE_HEIGHT, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.needleGreen, borderRadius: 12, alignItems: 'center', justifyContent: 'center', padding: 12, gap: 8 },
  addText: { textAlign: 'center', color: Colors.needleGreen, fontSize: 13, fontWeight: '600' },
  hint: { color: Colors.inkLight, fontSize: 13, lineHeight: 19, marginVertical: 12 },
  skeleton: { width: TILE_WIDTH, height: TILE_HEIGHT, borderRadius: 12, backgroundColor: Colors.boneDeep },
  pendingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', gap: 8 },
  overlayText: { color: Colors.textInverse, fontSize: 13, fontWeight: '600' },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  previewTile: { width: 80, height: 100, borderRadius: 8, backgroundColor: Colors.boneDeep },
  previewCaption: { color: Colors.inkLight, fontSize: 13, flex: 1 },
  viewerBar: { position: 'absolute', bottom: 24, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-around', backgroundColor: Colors.ink, paddingVertical: 18, borderRadius: 12 },
  viewerAction: { color: Colors.textInverse, fontWeight: '600' },
})

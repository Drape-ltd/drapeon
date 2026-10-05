/**
 * Portfolio management screen — add, edit, delete portfolio items.
 * Each item has an image, title, and optional description.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View, Text, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, Modal, ScrollView,
  Dimensions,
} from 'react-native'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import { supabase, invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { createValidatedUploadPayload, uploadPublicStorageImage } from '@/lib/storage-upload'
import {
  DrapeMediaViewer,
  PortfolioVideoPreview,
  RemoteImage,
  type DrapeMediaViewerItem,
} from '@/components/ui'
import { Sentry } from '@/lib/sentry'
import {
  launchImagePickerSafely,
  preferCompatibleVideoRepresentation,
  preferCurrentAssetRepresentation,
} from '@/lib/image-picker-safe'
import {
  pickerVideoContentType as portfolioVideoContentType,
  pickerVideoExtension as portfolioVideoExtension,
  validateVideoPickerAsset,
} from '@/lib/video-asset'
import { Colors, Spacing } from '@/constants/theme'
import { goBackOrReturnTo, pickSafeReturnTo } from '@/lib/navigation'
import { useContextualBackHandler } from '@/lib/use-contextual-back'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from '@/lib/function-errors'
import {
  ALLOWED_VIDEO_CONTENT_TYPES,
  MEDIA_CACHE_CONTROL_SECONDS,
  MEDIA_LIMITS_BYTES,
  MEDIA_LIMITS_SECONDS,
  VIDEO_DURATION_LIMIT_MESSAGE,
} from '@drape/shared/media-policy'
import { marketplaceMediaContentPosition, normalizeFocalPoint } from '@drape/shared'
import { styles } from '@/features/tailor-profile/portfolio-styles'

const { width: SCREEN_WIDTH } = Dimensions.get('window')

const MAX_PORTFOLIO_VIDEOS = 4
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

type PortfolioImageSource = 'camera' | 'library'
type PortfolioVideoSource = 'camera' | 'library'

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
    title: row.title ?? 'Portfolio work',
    description: row.description ?? null,
    sortOrder: row.sort_order ?? 0,
    focalX: 0.5,
    focalY: 0.5,
  }
}

const EMPTY_EDIT: EditForm = {
  id: null, imageUrl: '', imageUri: '', title: '', description: '',
  mediaAssetId: null, focalX: 0.5, focalY: 0.5,
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
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const [tailorProfileId, setTailorProfileId] = useState<string | null>(null)
  const [editModal, setEditModal] = useState<EditForm | null>(null)
  const [cropBox, setCropBox] = useState({ width: 1, height: 1 })
  const [cropLoading, setCropLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [coverSavingId, setCoverSavingId] = useState<string | null>(null)
  const [uploadingVideo, setUploadingVideo] = useState(false)
  const [removingVideoUrl, setRemovingVideoUrl] = useState<string | null>(null)
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)
  const [expandedViewerIndex, setExpandedViewerIndex] = useState(0)
  const [activePortfolioVideoIndex, setActivePortfolioVideoIndex] = useState<number | null>(null)
  const portfolioVideoViewerItems = useMemo<DrapeMediaViewerItem[]>(
    () => portfolioVideoUrls.map((uri, index) => ({
      uri,
      kind: 'video',
      label: `Portfolio video ${index + 1}`,
      contextId: `portfolio-video-${index + 1}`,
    })),
    [portfolioVideoUrls],
  )

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
      setTailorProfileId(pid)
      if (!pid) { setLoading(false); return }

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

  function openImageSourcePicker(onPicked: (uri: string) => void) {
    Alert.alert('Portfolio photo', 'Take a photo now or choose one from your library.', [
      { text: 'Take photo', onPress: () => void pickImage('camera', onPicked) },
      { text: 'Choose from library', onPress: () => void pickImage('library', onPicked) },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  async function pickImage(source: PortfolioImageSource, onPicked: (uri: string) => void) {
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      Alert.alert(
        'Permission needed',
        source === 'camera'
          ? 'Allow camera access to take portfolio photos.'
          : 'Allow photo access to upload portfolio images.',
      )
      return
    }

    const pickerOptions = {
      mediaTypes: 'images' as const,
      allowsEditing: true,
      aspect: [4, 5] as [number, number],
      quality: 0.85,
    }
    const result = await launchImagePickerSafely(
      () =>
        source === 'camera'
          ? ImagePicker.launchCameraAsync(pickerOptions)
          : ImagePicker.launchImageLibraryAsync(preferCurrentAssetRepresentation(pickerOptions)),
      {
        context: 'tailor_portfolio_photo_picker',
        mediaLabel: 'portfolio image',
        extra: { source, userId },
      }
    )
    if (!result) return
    if (!result.canceled && result.assets[0]) {
      onPicked(result.assets[0].uri)
    }
  }

  async function uploadImage(uri: string): Promise<string | null> {
    if (!userId) return null
    try {
      const compressed = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 800 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
      )
      const fileName = `portfolio/${userId}/${new Date().getTime()}.jpg`
      return await uploadPublicStorageImage({
        bucket: 'portfolio-photos',
        path: fileName,
        uri: compressed.uri,
        contentType: 'image/jpeg',
        maxBytes: 10 * 1024 * 1024,
      })
    } catch (err) {
      Sentry.captureException(err, { extra: { context: 'tailor_portfolio_upload', userId: user?.id } })
      return null
    }
  }

  function openVideoSourcePicker() {
    if (portfolioVideoUrls.length >= MAX_PORTFOLIO_VIDEOS) {
      Alert.alert('Video limit', `You can include up to ${MAX_PORTFOLIO_VIDEOS} videos in your portfolio.`)
      return
    }
    Alert.alert('Portfolio video', 'Record a short clip now or choose one from your library.', [
      { text: 'Record video', onPress: () => void pickPortfolioVideo('camera') },
      { text: 'Choose from library', onPress: () => void pickPortfolioVideo('library') },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  async function pickPortfolioVideo(source: PortfolioVideoSource) {
    if (!userId) return
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      Alert.alert(
        'Permission needed',
        source === 'camera'
          ? 'Allow camera access to record portfolio videos.'
          : 'Allow photo access to upload portfolio videos.',
      )
      return
    }

    const result = await launchImagePickerSafely(
      () =>
        source === 'camera'
          ? ImagePicker.launchCameraAsync({
              mediaTypes: 'videos',
              quality: 0.8,
              videoMaxDuration: MAX_PORTFOLIO_VIDEO_SECONDS,
            })
          : ImagePicker.launchImageLibraryAsync(
              preferCompatibleVideoRepresentation({
                mediaTypes: 'videos',
                quality: 0.8,
                videoMaxDuration: MAX_PORTFOLIO_VIDEO_SECONDS,
              })
            ),
      {
        context: 'tailor_portfolio_video_picker',
        mediaLabel: 'portfolio video',
        extra: { source, userId },
      }
    )
    if (!result) return
    if (result.canceled || !result.assets[0]) return

    const asset = result.assets[0]
    const validationMessage = validatePortfolioVideoAsset(asset)
    if (validationMessage) {
      Alert.alert('Video not added', validationMessage)
      return
    }

    setUploadingVideo(true)
    try {
      const contentType = portfolioVideoContentType(asset)
      const extension = portfolioVideoExtension(asset)
      const payload = await createValidatedUploadPayload(asset.uri, {
        maxBytes: MAX_PORTFOLIO_VIDEO_BYTES,
        contentType,
        allowedContentTypes: ALLOWED_VIDEO_CONTENT_TYPES,
        purpose: 'PORTFOLIO',
      })
      const filename = `portfolio/${userId}/videos/${new Date().getTime()}.${extension}`
      const { error: uploadError } = await supabase.storage
        .from('portfolio-photos')
        .upload(filename, payload.data, { contentType, cacheControl: MEDIA_CACHE_CONTROL_SECONDS.publicImmutable })
      if (uploadError) throw uploadError

      const { data: publicUrlData } = supabase.storage.from('portfolio-photos').getPublicUrl(filename)
      const nextVideoUrls = Array.from(new Set([...portfolioVideoUrls, publicUrlData.publicUrl])).slice(
        0,
        MAX_PORTFOLIO_VIDEOS
      )
      const { error } = await invokeFunction('tailor-profile-action', {
        body: { action: 'update-portfolio-videos', videoUrls: nextVideoUrls },
      })
      if (error) throw error
      setPortfolioVideoUrls(nextVideoUrls)
    } catch (err) {
      Sentry.captureException(err, { extra: { context: 'tailor_portfolio_video_upload', userId: user?.id } })
      Alert.alert(
        'Video upload failed',
        isLikelyConnectivityIssue(err)
          ? 'Connection looks weak. Retry this video when the signal improves.'
          : 'We could not upload this video right now. Please try again in a moment.'
      )
    } finally {
      setUploadingVideo(false)
    }
  }

  async function removePortfolioVideo(videoUrl: string) {
    setRemovingVideoUrl(videoUrl)
    try {
      const nextVideoUrls = portfolioVideoUrls.filter((url) => url !== videoUrl)
      const { error } = await invokeFunction('tailor-profile-action', {
        body: { action: 'update-portfolio-videos', videoUrls: nextVideoUrls },
      })
      if (error) throw error
      setPortfolioVideoUrls(nextVideoUrls)
    } catch (err) {
      Alert.alert(
        'Could not remove video',
        isLikelyConnectivityIssue(err)
          ? 'Connection looks weak. Retry when the signal improves.'
          : 'We could not remove this video right now.'
      )
    } finally {
      setRemovingVideoUrl(null)
    }
  }

  function openNew() {
    setEditModal({ ...EMPTY_EDIT })
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
    setEditModal((current) => current ? {
      ...current,
      focalX: normalizeFocalPoint(event.nativeEvent.locationX / cropBox.width),
      focalY: normalizeFocalPoint(event.nativeEvent.locationY / cropBox.height),
    } : current)
  }

  function goBack() {
    goBackOrReturnTo(router, navigation, pickSafeReturnTo(params.historyChain, params.returnTo), '/(tailor)/profile')
  }

  useContextualBackHandler(goBack)

  async function handleSave() {
    if (!editModal) return
    if (!editModal.title.trim()) {
      Alert.alert('Title required', 'Please add a title for this portfolio item.')
      return
    }
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
      const uploaded = await uploadImage(editModal.imageUri)
      if (!uploaded) {
        Alert.alert('Upload failed', 'Could not upload image. Please try again.')
        setSaving(false)
        return
      }
      finalImageUrl = uploaded
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
    setCoverSavingId(null)
  }

  async function handleDelete(item: PortfolioItem) {
    if (deletingId) return
    Alert.alert(
      'Delete item?',
      `Remove "${item.title}" from your portfolio?`,
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
            setDeletingId(null)
          },
        },
      ]
    )
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Portfolio</Text>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.stateTitle}>Loading your portfolio…</Text>
            <Text style={styles.stateHint}>
              We’re pulling in the work customers use to judge your craft, taste, and fit for their order.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (fetchError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Portfolio</Text>
            <Text style={styles.stateTitle}>Couldn't load your portfolio.</Text>
            <Text style={styles.stateHint}>
              This screen should help you keep the visual proof of your craft polished and current for new customers.
            </Text>
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={() => {
                setLoading(true)
                loadData()
              }}
            >
              <Text style={styles.retryBtnText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={goBack}
            >
              <Text style={styles.secondaryBtnText}>Go back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Portfolio</Text>
        <TouchableOpacity style={styles.addBtn} onPress={openNew} hitSlop={8}>
          <Feather name="plus" size={20} color={Colors.textInverse} />
        </TouchableOpacity>
      </View>

      <FlatList
        style={styles.list}
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={2}
        contentContainerStyle={styles.grid}
        columnWrapperStyle={styles.gridRow}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={(
          <View style={styles.listHeader}>
            <View style={styles.heroCard}>
              <View style={styles.heroBadge}>
                <Text style={styles.heroBadgeText}>Proof of craft</Text>
              </View>
              <Text style={styles.heroTitle}>Show the work that makes customers stop and trust.</Text>
              <Text style={styles.heroSub}>
                A strong portfolio helps customers understand your range, quality, and aesthetic before
                they ever send a brief.
              </Text>
            </View>

            <View style={styles.guideCard}>
              <Text style={styles.guideEyebrow}>Best approach</Text>
              <Text style={styles.guideTitle}>Lead with the work you most want to be booked for.</Text>
              <Text style={styles.guideCopy}>
                A few strong pieces beat a crowded gallery. Use this space to signal your taste, quality, and the kind of commissions you want more of.
              </Text>
            </View>

            <View style={styles.videoCard}>
              <View style={styles.videoHeader}>
                <View style={styles.videoHeaderCopy}>
                  <Text style={styles.guideEyebrow}>Portfolio videos</Text>
                  <Text style={styles.videoTitle}>Show movement, finish, and detail.</Text>
                  <Text style={styles.videoHint}>
                    MP4 or MOV, up to {MAX_PORTFOLIO_VIDEO_SECONDS} seconds and {Math.round(MAX_PORTFOLIO_VIDEO_BYTES / (1024 * 1024))} MB.
                  </Text>
                </View>
                <Text style={styles.videoCount}>{portfolioVideoUrls.length}/{MAX_PORTFOLIO_VIDEOS}</Text>
              </View>
              {portfolioVideoUrls.length > 0 ? (
                <ScrollView
                  horizontal
                  nestedScrollEnabled
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.videoStrip}
                >
                  {portfolioVideoUrls.map((videoUrl, index) => (
                    <View key={videoUrl} style={styles.videoTile}>
                      <TouchableOpacity
                        style={styles.videoOpen}
                        activeOpacity={0.84}
                        onPress={() => setActivePortfolioVideoIndex(index)}
                        accessibilityRole="button"
                        accessibilityLabel={`Open portfolio video ${index + 1}`}
                      >
                        <PortfolioVideoPreview uri={videoUrl} style={styles.videoPreview} autoplay={false} />
                        <View style={styles.videoOverlayBadge}>
                          <Feather name="play" size={12} color={Colors.textInverse} />
                          <Text style={styles.videoOverlayText}>Video {index + 1}</Text>
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.videoRemove}
                        onPress={() => { void removePortfolioVideo(videoUrl) }}
                        disabled={removingVideoUrl === videoUrl}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove portfolio video ${index + 1}`}
                      >
                        {removingVideoUrl === videoUrl ? (
                          <ActivityIndicator size="small" color={Colors.textInverse} />
                        ) : (
                          <Feather name="x" size={14} color={Colors.textInverse} />
                        )}
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              ) : null}
              <TouchableOpacity
                style={[
                  styles.videoAddBtn,
                  (uploadingVideo || portfolioVideoUrls.length >= MAX_PORTFOLIO_VIDEOS) && styles.videoAddBtnDisabled,
                ]}
                onPress={openVideoSourcePicker}
                disabled={uploadingVideo || portfolioVideoUrls.length >= MAX_PORTFOLIO_VIDEOS}
                accessibilityRole="button"
                accessibilityLabel="Add portfolio video"
              >
                {uploadingVideo ? (
                  <ActivityIndicator size="small" color={Colors.needleGreen} />
                ) : (
                  <Feather name="video" size={16} color={Colors.needleGreen} />
                )}
                <Text style={styles.videoAddText}>
                  {uploadingVideo ? 'Uploading video…' : 'Add portfolio video'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.galleryHeading}>
              <Text style={styles.guideEyebrow}>Portfolio work</Text>
              <Text style={styles.galleryCount}>{items.length} {items.length === 1 ? 'piece' : 'pieces'}</Text>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyBadge}>
              <Text style={styles.emptyBadgeText}>Portfolio</Text>
            </View>
            <Feather name="image" size={40} color={Colors.lightGrey} style={{ marginBottom: Spacing.md }} />
            <Text style={styles.emptyTitle}>No portfolio items yet</Text>
            <Text style={styles.emptyHint}>
              Showcase your best work so future customers can judge your craft, style, and fit before they book.
            </Text>
            <TouchableOpacity style={styles.emptyAddBtn} onPress={openNew}>
              <Feather name="plus" size={16} color={Colors.textInverse} />
              <Text style={styles.emptyAddBtnText}>Add first item</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item, index }) => (
          <TouchableOpacity
            style={styles.gridItem}
            onPress={() => {
              const nextIndex = items.findIndex((portfolioItem) => portfolioItem.id === item.id)
              setExpandedViewerIndex(nextIndex >= 0 ? nextIndex : 0)
              setExpandedIndex(nextIndex >= 0 ? nextIndex : 0)
            }}
            onLongPress={() => openEdit(item)}
            activeOpacity={0.85}
          >
            <RemoteImage
              uri={item.imageUrl}
              bucket="portfolio-photos"
              style={styles.gridImage}
              contentFit="cover"
              contentPosition={marketplaceMediaContentPosition({ focalX: item.focalX ?? 0.5, focalY: item.focalY ?? 0.5 })}
              transition={120}
              surface="tailor_portfolio_grid"
            />
            {index === 0 ? (
              <View style={styles.coverBadge}>
                <Feather name="star" size={11} color={Colors.textInverse} />
                <Text style={styles.coverBadgeText}>Explore cover</Text>
              </View>
            ) : null}
            <View style={styles.gridOverlay}>
              <Text style={styles.gridTitle} numberOfLines={1}>{item.title}</Text>
            </View>
            <TouchableOpacity
              style={styles.editBadge}
              onPress={() => openEdit(item)}
              hitSlop={8}
            >
              <Feather name="edit-2" size={12} color={Colors.textInverse} />
            </TouchableOpacity>
          </TouchableOpacity>
        )}
      />

      {/* ── Edit / Add modal ── */}
      {editModal && (
        <Modal animationType="slide" presentationStyle="pageSheet" visible onRequestClose={() => setEditModal(null)}>
          <SafeAreaView style={styles.modalSafe} edges={['top', 'bottom']}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setEditModal(null)} hitSlop={8}>
                <Feather name="x" size={22} color={Colors.ink} />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>{editModal.id ? 'Edit item' : 'Add to portfolio'}</Text>
              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.5 }]}
                onPress={handleSave}
                disabled={saving}
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
                    contentFit="cover"
                    contentPosition={marketplaceMediaContentPosition(editModal)}
                    transition={120}
                    surface="tailor_portfolio_editor_preview"
                  />
                ) : (
                  <View style={styles.imagePickerEmpty}>
                    <Feather name="image" size={32} color={Colors.midGrey} />
                    <Text style={styles.imagePickerText}>Tap to add photo</Text>
                  </View>
                )}
                {(editModal.imageUri || editModal.imageUrl) ? (
                  <View pointerEvents="none" style={[
                    styles.focalMarker,
                    { left: `${editModal.focalX * 100}%`, top: `${editModal.focalY * 100}%` },
                  ]}>
                    <View style={styles.focalMarkerDot} />
                  </View>
                ) : null}
                {cropLoading ? (
                  <View style={styles.cropLoading}><ActivityIndicator size="small" color={Colors.textInverse} /></View>
                ) : null}
                <TouchableOpacity
                  style={styles.imagePickerBadge}
                  onPress={() => openImageSourcePicker((uri) => setEditModal((m) => m ? {
                    ...m, imageUri: uri, imageUrl: uri, mediaAssetId: null, focalX: 0.5, focalY: 0.5,
                  } : m))}
                  accessibilityRole="button"
                  accessibilityLabel="Change portfolio photo"
                  hitSlop={8}
                >
                  <Feather name="camera" size={14} color={Colors.textInverse} />
                </TouchableOpacity>
              </View>
              {(editModal.imageUri || editModal.imageUrl) ? (
                <View style={styles.cropHintRow}>
                  <Text style={styles.cropHint}>Drag the marker to keep the face or key detail in frame.</Text>
                  <TouchableOpacity onPress={() => setEditModal((current) => current ? { ...current, focalX: 0.5, focalY: 0.5 } : current)}>
                    <Text style={styles.cropReset}>Reset</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {/* Title */}
              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>Title *</Text>
                <TextInput
                  style={styles.input}
                  value={editModal.title}
                  onChangeText={(v) => setEditModal((m) => m ? { ...m, title: v } : m)}
                  placeholder="e.g. Wedding Agbada"
                  placeholderTextColor={Colors.midGrey}
                  autoCapitalize="words"
                />
              </View>

              {/* Description */}
              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>Description</Text>
                <TextInput
                  style={[styles.input, styles.multiline]}
                  value={editModal.description}
                  onChangeText={(v) => setEditModal((m) => m ? { ...m, description: v } : m)}
                  placeholder="Fabric, occasion, or anything notable…"
                  placeholderTextColor={Colors.midGrey}
                  multiline
                  numberOfLines={3}
                />
              </View>

              {/* Delete button (edit mode only) */}
              {editModal.id && (
                <>
                  {items[0]?.id === editModal.id ? (
                    <View style={styles.coverLockedBtn}>
                      <Feather name="star" size={16} color={Colors.needleGreen} />
                      <Text style={styles.coverLockedText}>Current Explore cover</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={[styles.coverBtn, coverSavingId === editModal.id && { opacity: 0.6 }]}
                      disabled={saving || coverSavingId === editModal.id}
                      onPress={() => {
                        const item = items.find((i) => i.id === editModal.id)
                        if (item) void makeExploreCover(item)
                      }}
                    >
                      {coverSavingId === editModal.id ? (
                        <ActivityIndicator size="small" color={Colors.needleGreen} />
                      ) : (
                        <>
                          <Feather name="star" size={16} color={Colors.needleGreen} />
                          <Text style={styles.coverBtnText}>Make Explore cover</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[styles.deleteBtn, deletingId === editModal.id && { opacity: 0.6 }]}
                    disabled={saving || deletingId === editModal.id}
                    onPress={() => {
                      const item = items.find((i) => i.id === editModal.id)
                      if (item) { setEditModal(null); handleDelete(item) }
                    }}
                  >
                    {deletingId === editModal.id ? (
                      <ActivityIndicator size="small" color={Colors.error} />
                    ) : (
                      <>
                        <Feather name="trash-2" size={16} color={Colors.error} />
                        <Text style={styles.deleteBtnText}>Delete item</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </>
              )}
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
            <TouchableOpacity style={styles.expandClose} onPress={() => setExpandedIndex(null)}>
              <Feather name="x" size={20} color={Colors.textInverse} />
            </TouchableOpacity>
          </View>
        </Modal>
      )}

      <DrapeMediaViewer
        items={portfolioVideoViewerItems}
        activeIndex={activePortfolioVideoIndex}
        onDismiss={() => setActivePortfolioVideoIndex(null)}
        testID="portfolio-video-viewer"
      />
    </SafeAreaView>
  )
}

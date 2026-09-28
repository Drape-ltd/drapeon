import { Button, DrapeMediaViewer, Input, PhoneNumberInput } from '@/components/ui'
import { ImageCropEditor } from '@/components/ui/ImageCropEditor'
import { Colors } from '@/constants/theme'
import {
  stageMediaContentType,
  stageMediaExtension,
  stageMediaFromAsset,
  StageMediaPreview,
  validateStageMedia,
  type StageMedia,
} from '@/features/orders/tailor/OrderStageMedia'
import { styles } from '@/features/orders/tailor/TailorOrderStyles'
import type { OrderDetail } from '@/features/orders/tailor/TailorOrderTypes'
import { capture } from '@/lib/analytics'
import {
  isLikelyConnectivityIssue,
  readFunctionErrorMessage,
  readFunctionErrorPayload,
} from '@/lib/function-errors'
import { hapticSuccess } from '@/lib/haptics'
import {
  launchImagePickerSafely,
  preferCompatibleVideoRepresentation,
} from '@/lib/image-picker-safe'
import { Sentry } from '@/lib/sentry'
import {
  getFulfillmentStagePreflightError,
  normalizeContactPhoneInput,
  normalizeDispatchReferenceInput,
  normalizeTrackingNumberInput,
} from '@/lib/shipping'
import { uploadPrivateStorageImage } from '@/lib/storage-upload'
import { stripExif } from '@/lib/stripExif'
import { invokeFunction } from '@/lib/supabase'
import { filterContactInfo, rejectPlaceholder } from '@drape/shared/contact-filter'
import {
  ALLOWED_ORDER_EVIDENCE_CONTENT_TYPES,
  MEDIA_LIMITS_BYTES,
  MEDIA_LIMITS_SECONDS,
} from '@drape/shared/media-policy'
import { type OrderStage } from '@drape/shared/order-machine'
import { Feather } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { useState } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  displayStageChoiceLabel,
  stageUpdateNotePlaceholder,
  stageUpdatePhotoHint,
  stageUpdatePhotoLabel,
  stageUpdatePhotoRequiredMessage,
} from './TailorStageCopy'

const ORDER_EVIDENCE_VIDEO_MAX_BYTES = MEDIA_LIMITS_BYTES.orderUpdateVideo
const ORDER_EVIDENCE_VIDEO_MAX_SECONDS = MEDIA_LIMITS_SECONDS.orderUpdateVideo
type StageSubmissionPurpose = 'STAGE_PROGRESS' | 'FABRIC_APPROVAL'

export function StageUpdateModal({
  visible,
  order,
  targetStage,
  submissionPurpose,
  onClose,
  onUpdated,
}: {
  visible: boolean
  order: OrderDetail
  targetStage: OrderStage
  submissionPurpose: StageSubmissionPurpose
  onClose: () => void
  onUpdated: (updatedStage: OrderStage) => void
}) {
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [primaryMedia, setPrimaryMedia] = useState<StageMedia | null>(null)
  const [secondMedia, setSecondMedia] = useState<StageMedia | null>(null)
  const [updating, setUpdating] = useState(false)
  const [trackingNumber, setTrackingNumber] = useState('')
  const [provider, setProvider] = useState('')
  const [reference, setReference] = useState('')
  const [deliveryContactName, setDeliveryContactName] = useState('')
  const [deliveryContactPhone, setDeliveryContactPhone] = useState('')
  const [mediaSourceSlot, setMediaSourceSlot] = useState<'primary' | 'secondary' | null>(null)
  const [stageMediaPreviewIndex, setStageMediaPreviewIndex] = useState<number | null>(null)
  const [cropEditor, setCropEditor] = useState<{
    slot: 'primary' | 'secondary'
    media: StageMedia
  } | null>(null)

  const nextStage: OrderStage = targetStage
  const fabricApprovalSubmission = submissionPurpose === 'FABRIC_APPROVAL'
  const progressOnlySubmission = !fabricApprovalSubmission && nextStage === order.stage
  const finishingNeedsSecondPhoto = order.orderKind === 'CUSTOM' && nextStage === 'FINISHING'

  function validateNote(t: string) {
    if (t.trim().length < 10) {
      setNoteError('Tell your customer what you are working on. Use at least 10 characters.')
      return false
    }
    const placeholder = rejectPlaceholder(t, 'Note')
    if (placeholder) {
      setNoteError(placeholder)
      return false
    }
    const res = filterContactInfo(t)
    if (res.blocked) {
      setNoteError("Contact details can't be included.")
      return false
    }
    setNoteError('')
    return true
  }

  async function pickStageMediaFromCamera(slot: 'primary' | 'secondary') {
    if (updating) return
    const permission = await ImagePicker.requestCameraPermissionsAsync()
    if (permission.status !== 'granted') {
      Alert.alert(
        'Camera access needed',
        'Allow camera access to take fresh production proof for this stage.'
      )
      return
    }
    const res = await launchImagePickerSafely(
      () =>
        ImagePicker.launchCameraAsync({
          mediaTypes: ['images', 'videos'],
          quality: 0.8,
          videoMaxDuration: ORDER_EVIDENCE_VIDEO_MAX_SECONDS,
        }),
      {
        context: 'tailor_order_stage_camera_picker',
        mediaLabel: 'stage proof media',
        extra: { slot, orderId: order?.id },
      }
    )
    if (!res) return
    if (!res.canceled && res.assets[0]) {
      const media = stageMediaFromAsset(res.assets[0])
      const mediaError = validateStageMedia(media)
      if (mediaError) {
        Alert.alert('Video not added', mediaError)
        return
      }
      if (slot === 'secondary') setSecondMedia(media)
      else setPrimaryMedia(media)
    }
  }

  async function pickStageMediaFromLibrary(slot: 'primary' | 'secondary') {
    if (updating) return
    const res = await launchImagePickerSafely(
      () =>
        ImagePicker.launchImageLibraryAsync(
          preferCompatibleVideoRepresentation({
            mediaTypes: ['images', 'videos'],
            quality: 0.8,
            videoMaxDuration: ORDER_EVIDENCE_VIDEO_MAX_SECONDS,
          })
        ),
      {
        context: 'tailor_order_stage_library_picker',
        mediaLabel: 'stage proof media file',
        extra: { slot, orderId: order?.id },
      }
    )
    if (!res) return
    if (!res.canceled && res.assets[0]) {
      const media = stageMediaFromAsset(res.assets[0])
      const mediaError = validateStageMedia(media)
      if (mediaError) {
        Alert.alert('Video not added', mediaError)
        return
      }
      if (slot === 'secondary') setSecondMedia(media)
      else setPrimaryMedia(media)
    }
  }

  async function pickAndCropStagePhoto(slot: 'primary' | 'secondary') {
    if (updating) return
    const res = await launchImagePickerSafely(
      () =>
        ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: false,
          quality: 0.9,
        }),
      {
        context: 'tailor_order_stage_crop_picker',
        mediaLabel: 'cropped stage proof photo',
        extra: { slot, orderId: order?.id },
      }
    )
    if (!res || res.canceled || !res.assets[0]) return
    const media = stageMediaFromAsset(res.assets[0])
    const mediaError = validateStageMedia(media)
    if (mediaError) {
      Alert.alert('Photo not added', mediaError)
      return
    }
    if (slot === 'secondary') setSecondMedia(media)
    else setPrimaryMedia(media)
    setCropEditor({ slot, media })
  }

  function cropExistingStagePhoto(slot: 'primary' | 'secondary') {
    if (updating || cropEditor) return
    const current = slot === 'secondary' ? secondMedia : primaryMedia
    if (!current || current.type !== 'image') return
    setCropEditor({ slot, media: current })
  }

  function pickStageMedia(slot: 'primary' | 'secondary' = 'primary') {
    if (updating) return
    setMediaSourceSlot(slot)
  }

  function chooseStageMediaSource(source: 'camera' | 'library' | 'crop') {
    const slot = mediaSourceSlot
    setMediaSourceSlot(null)
    if (!slot) return
    if (source === 'camera') void pickStageMediaFromCamera(slot)
    else if (source === 'crop') void pickAndCropStagePhoto(slot)
    else void pickStageMediaFromLibrary(slot)
  }

  function renderMediaSourceChooser(slot: 'primary' | 'secondary') {
    if (mediaSourceSlot !== slot) return null

    return (
      <View style={styles.mediaSourceInline}>
        <View style={styles.mediaSourceInlineHeader}>
          <View style={styles.mediaSourceActionCopy}>
            <Text style={styles.mediaSourceTitle}>Add proof media</Text>
            <Text style={styles.mediaSourceText}>
              Use fresh media from this exact stage. Reused proof is blocked.
            </Text>
          </View>
          <TouchableOpacity
            style={styles.mediaSourceInlineClose}
            onPress={() => setMediaSourceSlot(null)}
            disabled={updating}
            accessibilityRole="button"
            accessibilityLabel="Close proof media options"
          >
            <Feather name="x" size={20} color={Colors.ink} />
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={styles.mediaSourceAction}
          onPress={() => chooseStageMediaSource('camera')}
          disabled={updating}
        >
          <Feather name="camera" size={20} color={Colors.needleGreenDark} />
          <View style={styles.mediaSourceActionCopy}>
            <Text style={styles.mediaSourceActionTitle}>Take photo or video</Text>
            <Text style={styles.mediaSourceActionText}>Best for fresh production proof.</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.mediaSourceAction}
          onPress={() => chooseStageMediaSource('library')}
          disabled={updating}
        >
          <Feather name="image" size={20} color={Colors.needleGreenDark} />
          <View style={styles.mediaSourceActionCopy}>
            <Text style={styles.mediaSourceActionTitle}>Choose from library</Text>
            <Text style={styles.mediaSourceActionText}>
              Use only media captured for this stage.
            </Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.mediaSourceAction}
          onPress={() => chooseStageMediaSource('crop')}
          disabled={updating}
        >
          <Feather name="crop" size={20} color={Colors.needleGreenDark} />
          <View style={styles.mediaSourceActionCopy}>
            <Text style={styles.mediaSourceActionTitle}>Choose and crop photo</Text>
            <Text style={styles.mediaSourceActionText}>
              Frame the garment cleanly before upload.
            </Text>
          </View>
        </TouchableOpacity>
      </View>
    )
  }

  const stagedMediaItems = [primaryMedia, secondMedia]
    .filter((media): media is StageMedia => !!media)
    .map((media, index) => ({
      uri: media.uri,
      resolvedUri: media.uri,
      label: index === 0 ? 'Primary production proof' : 'Second production proof',
      kind: media.type === 'video' ? ('video' as const) : ('photo' as const),
    }))

  async function update() {
    if (updating) return
    if (!nextStage) return
    if (note.trim().length < 10) {
      Alert.alert(
        'Note required',
        'Tell your customer what you are working on. Use at least 10 characters.'
      )
      return
    }
    if (!validateNote(note)) return
    if (!primaryMedia) {
      Alert.alert('Proof media required', stageUpdatePhotoRequiredMessage(order, nextStage))
      return
    }
    if (finishingNeedsSecondPhoto && !secondMedia) {
      Alert.alert(
        'Second proof required',
        'Finishing needs front and back proof before it can be marked complete.'
      )
      return
    }
    const fulfillmentPreflightError =
      nextStage === 'SHIPPED' || nextStage === 'OUT_FOR_DELIVERY'
        ? getFulfillmentStagePreflightError({
            targetStage: nextStage,
            deliveryMethod: order.deliveryMethod,
            deliveryAddress: order.deliveryAddress,
            recipientName: order.recipientName,
            recipientPhone: order.recipientPhone,
            provider,
            reference,
            trackingNumber,
            contactName: deliveryContactName,
            contactPhone: deliveryContactPhone,
          })
        : null
    if (fulfillmentPreflightError) {
      Alert.alert(
        nextStage === 'OUT_FOR_DELIVERY'
          ? 'Delivery details required'
          : 'Shipping details required',
        fulfillmentPreflightError
      )
      return
    }
    setUpdating(true)

    try {
      const photoUrls: string[] = []
      const mediaFingerprints: string[] = []
      const evidenceMedia: Array<Record<string, unknown>> = []
      for (const media of [primaryMedia, secondMedia].filter(Boolean) as StageMedia[]) {
        const ext = stageMediaExtension(media)
        const assetKey = `${Date.now()}_${photoUrls.length}_${media.fingerprint.replace(/[^a-z0-9]/giu, '').slice(0, 20) || 'proof'}`
        const originalPath = `${order.id}/production/${nextStage.toLowerCase()}/${assetKey}/original.${ext}`
        await uploadPrivateStorageImage({
          bucket: 'commercial-evidence',
          path: originalPath,
          uri: media.originalUri ?? media.uri,
          contentType: stageMediaContentType(media),
          maxBytes:
            media.type === 'video' ? ORDER_EVIDENCE_VIDEO_MAX_BYTES : MEDIA_LIMITS_BYTES.image,
          allowedContentTypes: ALLOWED_ORDER_EVIDENCE_CONTENT_TYPES,
          purpose: 'PRODUCTION_STAGE',
        })
        let displayPath = originalPath
        if (media.type === 'image') {
          displayPath = `${order.id}/production/${nextStage.toLowerCase()}/${assetKey}/display.jpg`
          await uploadPrivateStorageImage({
            bucket: 'commercial-evidence',
            path: displayPath,
            uri: await stripExif(media.uri),
            contentType: 'image/jpeg',
            maxBytes: MEDIA_LIMITS_BYTES.image,
            allowedContentTypes: ALLOWED_ORDER_EVIDENCE_CONTENT_TYPES,
            purpose: 'PRODUCTION_STAGE',
          })
        }
        photoUrls.push(displayPath)
        evidenceMedia.push({
          mediaType: media.type === 'video' ? 'VIDEO' : 'IMAGE',
          bucket: 'commercial-evidence',
          originalPath,
          displayPath,
          posterPath: null,
          crop: media.crop ?? null,
        })
        mediaFingerprints.push(media.fingerprint)
      }

      const { data: efData, error: efError } = await invokeFunction('tailor-order-action', {
        body: {
          orderId: order.id,
          action: fabricApprovalSubmission
            ? 'submit-sourced-fabric'
            : progressOnlySubmission
              ? 'post-stage-progress'
              : 'advance-stage',
          ...(!fabricApprovalSubmission ? { targetStage: nextStage } : {}),
          note: note.trim() || undefined,
          photoUrl: evidenceMedia.length === 0 ? (photoUrls[0] ?? undefined) : undefined,
          photoUrls: evidenceMedia.length === 0 ? photoUrls : undefined,
          evidenceMedia,
          mediaFingerprints,
          trackingNumber:
            !fabricApprovalSubmission && nextStage === 'SHIPPED'
              ? normalizeTrackingNumberInput(trackingNumber) || undefined
              : undefined,
          fulfillmentProvider:
            !fabricApprovalSubmission && ['SHIPPED', 'OUT_FOR_DELIVERY'].includes(nextStage)
              ? provider.trim() || undefined
              : undefined,
          fulfillmentReference:
            !fabricApprovalSubmission && ['SHIPPED', 'OUT_FOR_DELIVERY'].includes(nextStage)
              ? normalizeDispatchReferenceInput(reference) || undefined
              : undefined,
          fulfillmentContactName:
            !fabricApprovalSubmission && ['SHIPPED', 'OUT_FOR_DELIVERY'].includes(nextStage)
              ? deliveryContactName.trim() || undefined
              : undefined,
          fulfillmentContactPhone:
            !fabricApprovalSubmission && ['SHIPPED', 'OUT_FOR_DELIVERY'].includes(nextStage)
              ? normalizeContactPhoneInput(deliveryContactPhone) || undefined
              : undefined,
        },
      })

      if (efError || !efData?.ok) {
        const errorPayload = efError ? await readFunctionErrorPayload(efError) : null
        const errorMessage =
          typeof efData?.message === 'string' && efData.message.trim().length > 0
            ? efData.message.trim()
            : typeof errorPayload?.message === 'string' && errorPayload.message.trim().length > 0
              ? errorPayload.message.trim()
              : efError
                ? await readFunctionErrorMessage(
                    efError,
                    'This update is not ready yet. Review the required order checks and try again.'
                  )
                : 'This update is not ready yet. Review the required order checks and try again.'
        const err = new Error(errorMessage)
        Sentry.captureException(err, {
          extra: {
            context: fabricApprovalSubmission
              ? 'submit_sourced_fabric'
              : progressOnlySubmission
                ? 'post_stage_progress'
                : 'advance_stage',
            orderId: order.id,
            targetStage: nextStage,
          },
        })
        throw err
      }

      capture(
        fabricApprovalSubmission
          ? 'fabric_approval_submitted'
          : progressOnlySubmission
            ? 'stage_progress_posted'
            : 'stage_advanced',
        {
          from_stage: order.stage,
          to_stage: nextStage,
          has_photo: photoUrls.length > 0,
          has_note: !!note.trim(),
        }
      )

      hapticSuccess()
      onUpdated(nextStage)
    } catch (e) {
      Sentry.captureException(e, {
        extra: {
          context: fabricApprovalSubmission ? 'fabric_approval_submit' : 'stage_update_submit',
          orderId: order.id,
          targetStage: nextStage,
        },
      })
      Alert.alert(
        fabricApprovalSubmission ? 'Fabric proof unavailable' : 'Update unavailable',
        isLikelyConnectivityIssue(e)
          ? `Connection looks weak. We could not save this ${fabricApprovalSubmission ? 'fabric approval proof' : 'stage update'} yet. Your note and photo stayed here, so retry when the signal improves.`
          : e instanceof Error && e.message
            ? e.message
            : fabricApprovalSubmission
              ? 'Could not submit this fabric for approval right now. Please try again.'
              : 'Could not update this stage right now. Please try again.'
      )
    } finally {
      setUpdating(false)
    }
  }

  return (
    <>
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={onClose}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <SafeAreaView style={styles.modalSafe}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={onClose} disabled={updating}>
                <Text style={styles.modalClose}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>
                {fabricApprovalSubmission
                  ? 'Submit fabric'
                  : progressOnlySubmission
                    ? 'Add progress'
                    : 'Update stage'}
              </Text>
              <View style={{ width: 60 }} />
            </View>

            <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
              <View style={styles.nextStageRow}>
                <Text style={styles.nextStageLabel}>
                  {fabricApprovalSubmission
                    ? 'Customer decision'
                    : progressOnlySubmission
                      ? 'Current stage'
                      : 'Advancing to'}
                </Text>
                <Text style={styles.nextStageValue}>
                  {fabricApprovalSubmission
                    ? 'Fabric approval'
                    : displayStageChoiceLabel(nextStage, order.orderKind)}
                </Text>
              </View>

              <Input
                label="Note to customer"
                placeholder={
                  fabricApprovalSubmission
                    ? 'e.g. "This is the exact deep forest green fabric selected for your order."'
                    : stageUpdateNotePlaceholder(order, nextStage)
                }
                value={note}
                onChangeText={(v) => {
                  setNote(v)
                  if (noteError) validateNote(v)
                }}
                onBlur={() => validateNote(note)}
                error={noteError}
                multiline
                numberOfLines={3}
                maxLength={300}
                filterContact
                required
              />

              {/* Progress proof */}
              <View>
                <Text style={styles.photoLabel}>
                  {fabricApprovalSubmission
                    ? 'Exact fabric for approval'
                    : stageUpdatePhotoLabel(order, nextStage)}{' '}
                  <Text style={{ color: Colors.error }}>*</Text>
                </Text>
                <Text style={styles.photoHint}>
                  {fabricApprovalSubmission
                    ? 'Show the exact fabric the customer will approve—not the market, supplier visit, or general sourcing progress. Use natural light and show color and weave clearly.'
                    : stageUpdatePhotoHint(order, nextStage)}
                </Text>
                {primaryMedia ? (
                  <View style={styles.photoPreviewWrap}>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Open primary production proof full screen"
                      accessibilityHint="Review this media before submitting the stage update"
                      activeOpacity={0.88}
                      onPress={() => setStageMediaPreviewIndex(0)}
                    >
                      <StageMediaPreview
                        uri={primaryMedia.uri}
                        mediaType={primaryMedia.type}
                        style={styles.photoPreview}
                        surface="tailor_stage_update_photo_preview"
                      />
                    </TouchableOpacity>
                    <View style={styles.photoActions}>
                      <TouchableOpacity
                        style={styles.photoReplace}
                        onPress={() => pickStageMedia('primary')}
                        disabled={updating}
                      >
                        <Feather name="refresh-cw" size={16} color={Colors.needleGreenDark} />
                        <Text style={styles.photoReplaceText}>Replace</Text>
                      </TouchableOpacity>
                      {primaryMedia.type === 'image' ? (
                        <TouchableOpacity
                          style={styles.photoReplace}
                          onPress={() => cropExistingStagePhoto('primary')}
                          disabled={updating || !!cropEditor}
                        >
                          <Feather name="crop" size={16} color={Colors.needleGreenDark} />
                          <Text style={styles.photoReplaceText}>Crop</Text>
                        </TouchableOpacity>
                      ) : null}
                      <TouchableOpacity
                        style={styles.photoRemove}
                        onPress={() => setPrimaryMedia(null)}
                        disabled={updating}
                      >
                        <Feather name="trash-2" size={16} color={Colors.error} />
                        <Text style={styles.photoRemoveText}>Remove</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.photoPickBtn}
                    onPress={() => pickStageMedia('primary')}
                    disabled={updating}
                  >
                    <View style={styles.photoPickIcon}>
                      <Feather name="camera" size={20} color={Colors.needleGreenDark} />
                    </View>
                    <Text style={styles.photoPickText}>Take or add photo/video</Text>
                    <Text style={styles.photoPickSubtext}>
                      Fresh proof keeps the timeline trusted. Use natural light and keep the garment
                      fully in frame.
                    </Text>
                  </TouchableOpacity>
                )}
                {renderMediaSourceChooser('primary')}
              </View>

              {finishingNeedsSecondPhoto ? (
                <View>
                  <Text style={styles.photoLabel}>
                    Second finishing proof <Text style={{ color: Colors.error }}>*</Text>
                  </Text>
                  <Text style={styles.photoHint}>
                    Add a second fresh angle so the customer and ops can verify finishing quality.
                  </Text>
                  {secondMedia ? (
                    <View style={styles.photoPreviewWrap}>
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel="Open second production proof full screen"
                        accessibilityHint="Review this media before submitting the stage update"
                        activeOpacity={0.88}
                        onPress={() => setStageMediaPreviewIndex(primaryMedia ? 1 : 0)}
                      >
                        <StageMediaPreview
                          uri={secondMedia.uri}
                          mediaType={secondMedia.type}
                          style={styles.photoPreview}
                          surface="tailor_stage_update_second_photo_preview"
                        />
                      </TouchableOpacity>
                      <View style={styles.photoActions}>
                        <TouchableOpacity
                          style={styles.photoReplace}
                          onPress={() => pickStageMedia('secondary')}
                          disabled={updating}
                        >
                          <Feather name="refresh-cw" size={16} color={Colors.needleGreenDark} />
                          <Text style={styles.photoReplaceText}>Replace</Text>
                        </TouchableOpacity>
                        {secondMedia.type === 'image' ? (
                          <TouchableOpacity
                            style={styles.photoReplace}
                            onPress={() => cropExistingStagePhoto('secondary')}
                            disabled={updating || !!cropEditor}
                          >
                            <Feather name="crop" size={16} color={Colors.needleGreenDark} />
                            <Text style={styles.photoReplaceText}>Crop</Text>
                          </TouchableOpacity>
                        ) : null}
                        <TouchableOpacity
                          style={styles.photoRemove}
                          onPress={() => setSecondMedia(null)}
                          disabled={updating}
                        >
                          <Feather name="trash-2" size={16} color={Colors.error} />
                          <Text style={styles.photoRemoveText}>Remove</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.photoPickBtn}
                      onPress={() => pickStageMedia('secondary')}
                      disabled={updating}
                    >
                      <View style={styles.photoPickIcon}>
                        <Feather name="camera" size={20} color={Colors.needleGreenDark} />
                      </View>
                      <Text style={styles.photoPickText}>Take or add second proof</Text>
                      <Text style={styles.photoPickSubtext}>
                        Use a different, well-lit angle for finishing quality.
                      </Text>
                    </TouchableOpacity>
                  )}
                  {renderMediaSourceChooser('secondary')}
                </View>
              ) : null}

              {['SHIPPED', 'OUT_FOR_DELIVERY'].includes(nextStage) && (
                <View style={styles.shippingFields}>
                  <Input
                    label={
                      nextStage === 'OUT_FOR_DELIVERY' ? 'Delivery partner' : 'Courier or shipper'
                    }
                    placeholder={
                      nextStage === 'OUT_FOR_DELIVERY'
                        ? 'e.g. Gokada, Uber package, Local rider'
                        : 'e.g. DHL, UPS, FedEx'
                    }
                    value={provider}
                    onChangeText={setProvider}
                    autoCapitalize="words"
                    hint="Required so the customer knows who has the order."
                    required
                  />
                  {order.recipientName || order.recipientPhone ? (
                    <View style={styles.supportCard}>
                      <Text style={styles.supportCardTitle}>Recipient details</Text>
                      {order.recipientName ? (
                        <Text style={styles.supportHint}>Name: {order.recipientName}</Text>
                      ) : null}
                      {order.recipientPhone ? (
                        <Text style={styles.supportHint}>Phone: {order.recipientPhone}</Text>
                      ) : null}
                      {order.deliveryAddress ? (
                        <Text style={styles.supportHint}>Address: {order.deliveryAddress}</Text>
                      ) : null}
                    </View>
                  ) : null}
                  <Input
                    label="Tracking number"
                    placeholder="e.g. JD000095006536993823"
                    value={trackingNumber}
                    onChangeText={(value) => setTrackingNumber(normalizeTrackingNumberInput(value))}
                    autoCapitalize="characters"
                    hint={
                      nextStage === 'SHIPPED'
                        ? 'Use this when the courier provides formal tracking.'
                        : 'Optional for local delivery. Leave blank if there is no formal tracking.'
                    }
                  />
                  <Input
                    label={
                      nextStage === 'OUT_FOR_DELIVERY'
                        ? 'Trip or dispatch reference'
                        : 'Shipment reference'
                    }
                    placeholder={
                      nextStage === 'OUT_FOR_DELIVERY'
                        ? 'e.g. trip id, rider booking code'
                        : 'e.g. booking code, parcel reference'
                    }
                    value={reference}
                    onChangeText={(value) => setReference(normalizeDispatchReferenceInput(value))}
                    autoCapitalize="characters"
                    hint={
                      nextStage === 'SHIPPED'
                        ? 'Required if there is no formal tracking number.'
                        : 'Optional, but helpful for support and follow-up.'
                    }
                    required={nextStage === 'SHIPPED' && !trackingNumber.trim()}
                  />
                  <Input
                    label={
                      nextStage === 'OUT_FOR_DELIVERY'
                        ? 'Rider or delivery contact'
                        : 'Courier or shipping contact'
                    }
                    placeholder={
                      nextStage === 'OUT_FOR_DELIVERY'
                        ? 'e.g. Tunde, Dispatch desk'
                        : 'e.g. DHL desk, Parcel hub contact'
                    }
                    value={deliveryContactName}
                    onChangeText={setDeliveryContactName}
                    autoCapitalize="words"
                    hint={
                      nextStage === 'OUT_FOR_DELIVERY'
                        ? 'Required so the customer knows who is trying to reach them.'
                        : 'Required so the customer knows who accepted the parcel.'
                    }
                    required
                  />
                  <PhoneNumberInput
                    label={
                      nextStage === 'OUT_FOR_DELIVERY'
                        ? 'Delivery contact phone'
                        : 'Shipping contact phone'
                    }
                    placeholder="Phone number"
                    value={deliveryContactPhone}
                    onChangeText={setDeliveryContactPhone}
                    hint={
                      nextStage === 'OUT_FOR_DELIVERY'
                        ? 'Required so the customer can identify the active rider.'
                        : 'Required so the customer can identify the courier or shipping desk.'
                    }
                    required
                  />
                  <Text style={styles.shippingWarning}>
                    {nextStage === 'OUT_FOR_DELIVERY'
                      ? 'Only mark this as out for delivery after the rider or local delivery partner has actually accepted the order. Keep rider, contact, and dispatch updates in Drapeon so support can recover the timeline if anything goes wrong.'
                      : 'Only mark this as shipped after the courier has actually accepted the parcel. Keep provider, tracking, shipment reference, and customs updates in Drapeon so support can recover the timeline if anything goes wrong.'}
                  </Text>
                  {!order.deliveryAddress?.trim() ? (
                    <Text style={styles.shippingWarning}>
                      Delivery address is missing on this order. Ask the customer to update it
                      before marking this handoff as started.
                    </Text>
                  ) : null}
                </View>
              )}

              <Button
                label={
                  fabricApprovalSubmission
                    ? 'Send for customer approval'
                    : progressOnlySubmission
                      ? 'Post sourcing update'
                      : 'Confirm update'
                }
                onPress={update}
                loading={updating}
                disabled={
                  updating ||
                  note.trim().length < 10 ||
                  !!noteError ||
                  !primaryMedia ||
                  (finishingNeedsSecondPhoto && !secondMedia) ||
                  (nextStage === 'SHIPPED' &&
                    (!provider.trim() ||
                      (!trackingNumber.trim() && !reference.trim()) ||
                      !deliveryContactName.trim() ||
                      !deliveryContactPhone.trim())) ||
                  (nextStage === 'OUT_FOR_DELIVERY' &&
                    (!provider.trim() ||
                      !deliveryContactName.trim() ||
                      !deliveryContactPhone.trim()))
                }
              />
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
      <DrapeMediaViewer
        items={stagedMediaItems}
        activeIndex={stageMediaPreviewIndex}
        onDismiss={() => setStageMediaPreviewIndex(null)}
        testID="tailor-stage-evidence-preview"
      />
      <ImageCropEditor
        visible={!!cropEditor}
        uri={cropEditor?.media.uri ?? null}
        sourceWidth={cropEditor?.media.width}
        sourceHeight={cropEditor?.media.height}
        aspect={[4, 3]}
        onCancel={() => setCropEditor(null)}
        onComplete={(result) => {
          if (!cropEditor) return
          const nextMedia: StageMedia = {
            uri: result.uri,
            originalUri: cropEditor.media.originalUri ?? result.originalUri,
            type: 'image',
            width: result.width,
            height: result.height,
            fileSize: null,
            mimeType: 'image/jpeg',
            crop: {
              ...result.crop,
              sourceWidth: cropEditor.media.width ?? result.crop.width,
              sourceHeight: cropEditor.media.height ?? result.crop.height,
            },
            fingerprint: `interactive-crop-4x3|${cropEditor.media.fingerprint}|${result.width}x${result.height}`,
          }
          if (cropEditor.slot === 'secondary') setSecondMedia(nextMedia)
          else setPrimaryMedia(nextMedia)
          setCropEditor(null)
        }}
      />
    </>
  )
}

// ─── Consultation Modal ───────────────────────────────────────────────────────

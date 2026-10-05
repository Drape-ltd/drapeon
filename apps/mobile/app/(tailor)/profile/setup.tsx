/**
 * Tailor profile setup wizard — 4 steps
 * Step 0: Identity (display name, phone, location, bio, languages)
 * Step 1: Specialties + pricing
 * Step 2: Portfolio (at least one work sample)
 * Step 3: Fulfillment + private trust-video verification
 */
import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  Modal,
  TextInput,
  UIManager,
  Vibration,
  PanResponder,
  useWindowDimensions,
  Linking,
} from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import * as ImageManipulator from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'
import * as FileSystem from 'expo-file-system/legacy'
import { requestRecordingPermissionsAsync } from 'expo-audio'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Feather } from '@expo/vector-icons'
import { supabase, invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { pickAvatarImageUri } from '@/lib/avatar-picker'
import { detectDeviceCurrencyPreference, fetchCurrencyPreferenceContext } from '@/lib/currency'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from '@/lib/function-errors'
import { createValidatedUploadPayload, uploadPublicStorageImage } from '@/lib/storage-upload'
import { stripExif } from '@/lib/stripExif'
import { appendToHistory, resetTo } from '@/lib/navigation'
import {
  fetchOwnTailorProfileGuard,
  fetchOwnTailorSetupProfile,
} from '@/lib/tailor-profile-guard'
import {
  checkAccountPhoneAvailability,
  DUPLICATE_PHONE_MESSAGE,
  sendAccountPhoneOtp,
  saveOnboardingPhone,
  verifyAccountPhoneOtp,
} from '@/lib/account-profile-actions'
import { Sentry } from '@/lib/sentry'
import { useKeyboardState } from '@/lib/useKeyboardState'
import { hapticSuccess, hapticWarning } from '@/lib/haptics'
import {
  launchImagePickerSafely,
  preferCompatibleVideoRepresentation,
  preferCurrentAssetRepresentation,
} from '@/lib/image-picker-safe'
import {
  pickerVideoContentType as portfolioVideoContentType,
  pickerVideoDurationSeconds,
  pickerVideoExtension as portfolioVideoExtension,
  validateVideoPickerAsset,
} from '@/lib/video-asset'
import { AuthBackButton } from '@/components/auth/AuthBackButton'
import { AuthEntryHeader } from '@/components/auth/AuthEntryHeader'
import {
  AddressAutocompleteInput,
  Button,
  DrapeCapsuleButton,
  DrapeFloatingActionDock,
  DrapeIconButton,
  DRAPE_FLOATING_ACTION_DOCK_CLEARANCE,
  Input,
  KeyboardAwareScrollView,
  MoneyInput,
  PhoneNumberInput,
  RemoteImage,
  AvatarImage,
  PortfolioVideoPreview,
  TagSelector,
  ProgressStepper,
} from '@/components/ui'
import type { TagGroup } from '@/components/ui'
import {
  useDrapeCapsuleNavMotion,
  useDrapeCapsuleNavScroll,
} from '@/components/ui/DrapeCapsuleNav'
import { filterContactInfo, validateDisplayName } from '@drape/shared/contact-filter'
import {
  normalizePhoneForStorage,
  ACCOUNT_PHONE_UNIQUENESS_HINT,
  PHONE_STORAGE_HINT,
  validatePhoneForProfile,
} from '@drape/shared/phone'
import {
  deriveTailorSetupProgress,
  getTailorPriceMaxMajor,
  getTailorPriceMinMajor,
  parseTailorPriceMajor,
  TAILOR_SETUP_VALIDATION,
  type TailorSetupField,
  type TailorSetupFieldErrors,
  type TailorSetupStep,
} from '@drape/shared/tailor-setup'
import {
  TAILOR_LANGUAGE_GROUPS,
  TAILOR_SELLER_TYPE_OPTIONS,
  TAILOR_SPECIALTY_GROUPS,
  type AccountCurrencyCode,
} from '@drape/shared'
import {
  ALLOWED_VIDEO_CONTENT_TYPES,
  MEDIA_CACHE_CONTROL_SECONDS,
  MEDIA_LIMITS_BYTES,
  MEDIA_LIMITS_SECONDS,
  VIDEO_DURATION_LIMIT_MESSAGE,
} from '@drape/shared/media-policy'
import {
  IDENTITY_CONSENT_COPY,
  IDENTITY_CONSENT_POLICY_VERSION,
  TAILOR_TRUST_VIDEO_MAX_SECONDS,
  TAILOR_TRUST_VIDEO_MIN_SECONDS,
} from '@drape/shared/identity-trust'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import type { Availability } from '@/lib/shared-types'
import { styles } from '@/features/tailor-setup/TailorSetupStyles'
import { PortfolioSortableTile } from '@/features/tailor-setup/PortfolioSortableTile'
import { MAX_PORTFOLIO_VIDEOS, MAX_PORTFOLIO_VIDEO_BYTES, MAX_LANGUAGE_TAGS, MAX_SPECIALTY_TAGS, PORTFOLIO_GRID_COLUMNS, PORTFOLIO_GRID_TILE_SIZE, PORTFOLIO_GRID_CELL_SIZE, STEP_TITLES, STEP_SUBS, INVALID_PROFILE_IMAGE_REJECTION_CODE, INVALID_PORTFOLIO_MEDIA_REJECTION_CODE, PROFILE_IMAGE_REJECTION_MESSAGE, SETUP_STEP_IDS, STEP_LABELS, SETUP_ERROR_FIELD_PRIORITY, LANGUAGE_GROUPS, SPECIALTY_GROUPS, BIO_PROMPTS, PRICE_PRESETS, FOCUSED_FIELD_SCROLL_DELAY_MS, FOCUSED_FIELD_TOP_OFFSET, PHONE_AVAILABILITY_DEBOUNCE_MS, TAILOR_SETUP_DRAFT_VERSION, TRUST_VIDEO_DRAFT_DIRECTORY, tailorSetupDraftKey, trustVideoDraftDirectory, trustVideoDraftExtension, persistTrustVideoDraft, removeTrustVideoDraft, currencySyncRetryDelayMs, getPortfolioDropTargetIndex, previewPortfolioGridEntries, firstParam, readStringField, readIdentityRejectionCode, isProfileImageRejectionCode, isPortfolioMediaRejectionCode, readIdentityRejectionMessage, portfolioAssetDuplicateKey, validatePortfolioVideoAsset } from '@/features/tailor-setup/TailorSetupHelpers'
import { PhoneOtpModal } from '@/features/tailor-setup/PhoneOtpModal'
import { PortfolioMediaManagerModal } from '@/features/tailor-setup/PortfolioMediaManagerModal'
import { MediaChoiceSheet, SetupChoiceSheet, SetupSelectorCard } from '@/features/tailor-setup/TailorSetupSheets'
import type { PortfolioItem } from '@/features/tailor-setup/TailorSetupTypes'
import { MAX_PORTFOLIO_ITEMS, MIN_PORTFOLIO_ITEMS, MAX_PORTFOLIO_VIDEO_SECONDS, SUPPORTED_CURRENCIES, SELLER_TYPE_OPTIONS } from '@/features/tailor-setup/TailorSetupLimits'
import type { SellerType, ProfilePhotoSource, PortfolioMediaSource, TrustVideoSource, MediaSheetMode, SetupChoiceSheetMode } from '@/features/tailor-setup/TailorSetupTypes'

type PortfolioGridEntry = { item: PortfolioItem; originalIndex: number }
type VerificationStatus = 'NOT_SUBMITTED' | 'PENDING' | 'VERIFIED' | 'REJECTED'
type SetupView = 'hub' | 'section'
type SetupToast = { type: 'success' | 'error'; message: string }

type TailorSetupProfileRow = {
  id: string
  profile_completed: boolean | null
  display_name: string | null
  avatar_url: string | null
  bio: string | null
  location: string | null
  languages: unknown
  specialty_tags: unknown
  price_range_min: number | null
  price_range_max: number | null
  currency: string | null
  seller_type: string | null
  id_verification_status: string | null
  trust_verification_video_path?: string | null
  trust_verification_challenge_id?: string | null
  trust_verification_challenge_text?: string | null
  id_verification_rejection_reason?: string | null
  id_verification_rejected_at?: string | null
  id_verification_metadata?: Record<string, unknown> | null
  supports_custom_orders: boolean | null
  supports_ready_made: boolean | null
  pickup_available: boolean | null
  delivery_available: boolean | null
  shipping_available: boolean | null
  delivery_fee: number | null
  shipping_fee: number | null
  accepts_custom_orders_now: boolean | null
  shop_paused: boolean | null
  portfolio_photo_urls: unknown
  portfolio_video_urls: unknown
  availability: string | null
  ready_made_item_count: number | null
}

type UserCurrencyRow = {
  default_currency: string | null
  currency_source: string | null
  region_code: string | null
  phone: string | null
}

type PickupDetailsRow = {
  pickup_address: string | null
  pickup_city: string | null
  pickup_region: string | null
  pickup_postal_code: string | null
  pickup_country_code: string | null
  pickup_instructions: string | null
}

type NominatimSuggestion = {
  display_name?: unknown
  address?: {
    city?: unknown
    town?: unknown
    village?: unknown
    county?: unknown
    country?: unknown
  }
}

type ErrorWithStatus = {
  statusCode?: unknown
  name?: unknown
}


export default function TailorSetupScreen() {
  const router = useRouter()
  const routeParams = useLocalSearchParams<{
    handoffToken?: string | string[]
    openIdentity?: string | string[]
    view?: string | string[]
    step?: string | string[]
    historyChain?: string | string[]
  }>()
  const insets = useSafeAreaInsets()
  const { user, signOut, switchRole } = useAuth()
  const keyboard = useKeyboardState()
  const { compact: actionDockCompact } = useDrapeCapsuleNavMotion()
  const actionDockScroll = useDrapeCapsuleNavScroll()
  const handoffToken = useMemo(() => firstParam(routeParams.handoffToken)?.trim() || null, [routeParams.handoffToken])
  const routeRequestedStep = useMemo<TailorSetupStep | null>(() => {
    if (firstParam(routeParams.view) !== 'section') return null
    const parsed = Number(firstParam(routeParams.step))
    return parsed === 0 || parsed === 1 || parsed === 2 || parsed === 3 ? (parsed as TailorSetupStep) : null
  }, [routeParams.step, routeParams.view])
  const openIdentityFromHandoff = handoffToken !== null || firstParam(routeParams.openIdentity) === '1'
  const scrollRef = useRef<ScrollView | null>(null)
  const bioFieldYRef = useRef(0)
  const setupFieldYRef = useRef<Partial<Record<TailorSetupField, number>>>({})
  const setupToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const detectedCurrency = useMemo(() => detectDeviceCurrencyPreference(), [])
  const oauthName =
    user?.user_metadata?.display_name ??
    user?.user_metadata?.full_name ??
    user?.user_metadata?.name ??
    ''
  const oauthPhone = typeof user?.user_metadata?.phone === 'string' ? user.user_metadata.phone : ''
  const oauthVerifiedPhone =
    typeof user?.user_metadata?.verified_phone === 'string'
      ? user.user_metadata.verified_phone
      : typeof user?.user_metadata?.phone_verified_at === 'string'
        ? oauthPhone
        : ''

  // Guard: if the profile is already complete and ID is not pending re-submission,
  // prevent direct-URL re-entry which would allow upsert-overwrite of existing data.
  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    fetchOwnTailorProfileGuard(user.id).then(({ data, error }) => {
        if (cancelled) return
        if (error || !data) return
        if (
          data?.profile_completed &&
          data?.id_verification_status !== 'NOT_SUBMITTED' &&
          data?.id_verification_status !== 'REJECTED'
        ) {
          router.replace('/(tailor)/profile')
        }
    })
    return () => {
      cancelled = true
    }
  }, [router, user?.id])

  function handleSignOut() {
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          void signOut().catch(() => {
            Alert.alert(
              'Unable to sign out',
              'Please try again in a moment. You can stay here and continue setup, then sign out later if needed.'
            )
          })
        },
      },
    ])
  }

  function switchBackToCustomer() {
    if (switchingToCustomer) return
    Alert.alert(
      'Return to customer mode?',
      'Your tailor setup can wait. Drapeon will take you back to the customer side with this same account.',
      [
        { text: 'Stay here', style: 'cancel' },
        {
          text: 'Return to customer',
          onPress: () => {
            setSwitchingToCustomer(true)
            void switchRole('CUSTOMER')
              .then(({ error }) => {
                if (error) {
                  Alert.alert('Could not switch modes', error)
                  return
                }
                resetTo(router, '/(customer)')
              })
              .finally(() => setSwitchingToCustomer(false))
          },
        },
      ]
    )
  }

  const [step, setStep] = useState<TailorSetupStep>(0)
  const [setupView, setSetupView] = useState<SetupView>('hub')
  const [saving, setSaving] = useState(false)
  const [switchingToCustomer, setSwitchingToCustomer] = useState(false)
  const [visibleErrors, setVisibleErrors] = useState<TailorSetupFieldErrors>({})
  const [setupToast, setSetupToast] = useState<SetupToast | null>(null)
  const [focusedTextField, setFocusedTextField] = useState<string | null>(null)
  const [profileHydrated, setProfileHydrated] = useState(false)
  const [currencyHydrated, setCurrencyHydrated] = useState(false)
  const [hasPersistedProfile, setHasPersistedProfile] = useState(false)
  const [draftHydrated, setDraftHydrated] = useState(false)
  const draftSaveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const draftCompletedRef = useRef(false)
  const [pickupHydrated, setPickupHydrated] = useState(false)
  const [mediaSheetMode, setMediaSheetMode] = useState<MediaSheetMode>(null)
  const [choiceSheetMode, setChoiceSheetMode] = useState<SetupChoiceSheetMode>(null)
  const initialStepResolved = useRef(false)
  const routeSectionRestoreKey = useRef<string | null>(null)

  // Step 0
  const [displayName, setDisplayName] = useState(oauthName)
  const [identityConsentGranted, setIdentityConsentGranted] = useState(false)
  const [identityConsentError, setIdentityConsentError] = useState('')
  const [nameError, setNameError] = useState('')
  const [phone, setPhone] = useState(oauthPhone)
  const [phoneError, setPhoneError] = useState('')
  const [phoneAvailabilityChecking, setPhoneAvailabilityChecking] = useState(false)
  const [phoneOtpVisible, setPhoneOtpVisible] = useState(false)
  const [phoneOtpCode, setPhoneOtpCode] = useState('')
  const [phoneOtpError, setPhoneOtpError] = useState('')
  const [phoneOtpSending, setPhoneOtpSending] = useState(false)
  const [phoneOtpVerifying, setPhoneOtpVerifying] = useState(false)
  const [verifiedPhone, setVerifiedPhone] = useState(() => normalizePhoneForStorage(oauthVerifiedPhone))
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [bio, setBio] = useState('')
  const [bioError, setBioError] = useState('')
  const [location, setLocation] = useState('')
  const [locationSuggestions, setLocationSuggestions] = useState<string[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const locationDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestPhoneRef = useRef(phone)
  const phoneAvailabilityRequestRef = useRef(0)
  const verifiedPhoneRef = useRef(verifiedPhone)
  const phoneOtpAfterVerifyRef = useRef<'advance' | 'finish' | null>(null)

  useEffect(() => {
    return () => {
      if (setupToastTimerRef.current) {
        clearTimeout(setupToastTimerRef.current)
      }
    }
  }, [])
  const [languages, setLanguages] = useState<string[]>(['English'])

  // Step 1
  const [specialties, setSpecialties] = useState<string[]>([])
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('')
  const [currency, setCurrency] = useState<'GBP' | 'USD' | 'EUR' | 'NGN' | 'GHS' | 'KES' | 'CAD'>(
    detectedCurrency.currency
  )
  const [currencySource, setCurrencySource] = useState(detectedCurrency.source)
  const [regionCode, setRegionCode] = useState(detectedCurrency.regionCode)
  const priceMinGuide = useMemo(
    () => getTailorPriceMinMajor(currency).toLocaleString('en'),
    [currency]
  )
  const priceMaxGuide = useMemo(
    () => getTailorPriceMaxMajor(currency).toLocaleString('en'),
    [currency]
  )

  // Step 2
  const [portfolioItems, setPortfolioItems] = useState<PortfolioItem[]>([])
  const [uploadingMedia, setUploadingMedia] = useState(false)
  const [portfolioMediaStatus, setPortfolioMediaStatus] = useState<string | null>(null)
  const [selectedPortfolioIndex, setSelectedPortfolioIndex] = useState<number | null>(null)
  const [portfolioReplaceIndex, setPortfolioReplaceIndex] = useState<number | null>(null)
  const [portfolioDragIndex, setPortfolioDragIndex] = useState<number | null>(null)
  const [portfolioHoverIndex, setPortfolioHoverIndex] = useState<number | null>(null)
  const pickedUris = useRef<Set<string>>(new Set())
  const pickedAssetKeys = useRef<Set<string>>(new Set())

  // Step 3
  const [availability, setAvailability] = useState<Availability>('OPEN')
  const [sellerType, setSellerType] = useState<SellerType>('TAILOR')
  const [supportsCustomOrders, setSupportsCustomOrders] = useState(true)
  const [supportsReadyMade, setSupportsReadyMade] = useState(false)
  const [acceptsCustomOrdersNow, setAcceptsCustomOrdersNow] = useState(true)
  const [shopPaused, setShopPaused] = useState(false)
  const [readyMadeItemCount, setReadyMadeItemCount] = useState(0)
  const [pickupAvailable, setPickupAvailable] = useState(true)
  const [pickupAddress, setPickupAddress] = useState('')
  const [pickupCity, setPickupCity] = useState('')
  const [pickupRegion, setPickupRegion] = useState('')
  const [pickupPostalCode, setPickupPostalCode] = useState('')
  const [pickupCountryCode, setPickupCountryCode] = useState('')
  const [pickupInstructions, setPickupInstructions] = useState('')
  const [deliveryAvailable, setDeliveryAvailable] = useState(false)
  const [shippingAvailable, setShippingAvailable] = useState(false)
  const [trustVideoUri, setTrustVideoUri] = useState<string | null>(null)
  const [savedTrustVideoPath, setSavedTrustVideoPath] = useState('')
  const [trustHandoffToken, setTrustHandoffToken] = useState(handoffToken)
  const [trustChallengeId, setTrustChallengeId] = useState('')
  const [trustChallengeText, setTrustChallengeText] = useState('')
  const [trustChallengeLoading, setTrustChallengeLoading] = useState(false)
  const [trustVideoContentType, setTrustVideoContentType] = useState<'video/mp4' | 'video/quicktime'>('video/mp4')
  const [idVerificationStatus, setIdVerificationStatus] =
    useState<VerificationStatus>('NOT_SUBMITTED')
  const [idError, setIdError] = useState('')
  const [idRejectionReason, setIdRejectionReason] = useState('')
  const [idRejectionCode, setIdRejectionCode] = useState('')
  const [avatarRejectionCleared, setAvatarRejectionCleared] = useState(false)
  const [uploadingId, setUploadingId] = useState(false)

  useEffect(() => {
    if (!user?.id || !profileHydrated || !currencyHydrated || draftHydrated) return
    let cancelled = false
    void AsyncStorage.getItem(tailorSetupDraftKey(user.id))
      .then((value) => {
        if (cancelled || !value) return
        const draft = JSON.parse(value) as Record<string, unknown>
        if (draft.version !== TAILOR_SETUP_DRAFT_VERSION) return
        if (draft.setupView === 'hub' || draft.setupView === 'section') setSetupView(draft.setupView)
        if (typeof draft.step === 'number' && SETUP_STEP_IDS.includes(draft.step as TailorSetupStep)) {
          setStep(draft.step as TailorSetupStep)
        }
        if (typeof draft.displayName === 'string') setDisplayName(draft.displayName)
        if (typeof draft.phone === 'string') setPhone(draft.phone)
        if (typeof draft.avatarUrl === 'string' || draft.avatarUrl === null) setAvatarUrl(draft.avatarUrl)
        if (typeof draft.bio === 'string') setBio(draft.bio)
        if (typeof draft.location === 'string') setLocation(draft.location)
        if (Array.isArray(draft.languages)) setLanguages(draft.languages.filter((value): value is string => typeof value === 'string').slice(0, MAX_LANGUAGE_TAGS))
        if (Array.isArray(draft.specialties)) setSpecialties(draft.specialties.filter((value): value is string => typeof value === 'string').slice(0, MAX_SPECIALTY_TAGS))
        if (typeof draft.priceMin === 'string') setPriceMin(draft.priceMin)
        if (typeof draft.priceMax === 'string') setPriceMax(draft.priceMax)
        if (typeof draft.currency === 'string' && SUPPORTED_CURRENCIES.includes(draft.currency as typeof currency)) setCurrency(draft.currency as typeof currency)
        // Keep the local recording reference in the resumable draft. The
        // private video itself remains local until the existing signed upload
        // flow submits it; this only prevents a process restart between
        // recording and submission from silently dropping the handoff.
        if (typeof draft.trustVideoUri === 'string' && draft.trustVideoUri.trim().length > 0) {
          setTrustVideoUri(draft.trustVideoUri.trim())
        }
        if (draft.trustVideoContentType === 'video/mp4' || draft.trustVideoContentType === 'video/quicktime') {
          setTrustVideoContentType(draft.trustVideoContentType)
        }
        if (Array.isArray(draft.portfolioItems)) {
          const restoredItems = draft.portfolioItems.filter((item): item is PortfolioItem => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) return false
            const record = item as Record<string, unknown>
            return (record.type === 'photo' || record.type === 'video') && typeof record.url === 'string'
          })
          if (restoredItems.length > 0) setPortfolioItems(restoredItems.slice(0, MAX_PORTFOLIO_ITEMS))
        }
        if (draft.availability === 'OPEN' || draft.availability === 'LIMITED' || draft.availability === 'FULLY_BOOKED') setAvailability(draft.availability)
        if (draft.sellerType === 'TAILOR' || draft.sellerType === 'BOUTIQUE' || draft.sellerType === 'TAILOR_SHOP') setSellerType(draft.sellerType)
        if (typeof draft.supportsCustomOrders === 'boolean') setSupportsCustomOrders(draft.supportsCustomOrders)
        if (typeof draft.supportsReadyMade === 'boolean') setSupportsReadyMade(draft.supportsReadyMade)
        if (typeof draft.acceptsCustomOrdersNow === 'boolean') setAcceptsCustomOrdersNow(draft.acceptsCustomOrdersNow)
        if (typeof draft.shopPaused === 'boolean') setShopPaused(draft.shopPaused)
        if (typeof draft.pickupAvailable === 'boolean') setPickupAvailable(draft.pickupAvailable)
        if (typeof draft.pickupAddress === 'string') setPickupAddress(draft.pickupAddress)
        if (typeof draft.pickupCity === 'string') setPickupCity(draft.pickupCity)
        if (typeof draft.pickupRegion === 'string') setPickupRegion(draft.pickupRegion)
        if (typeof draft.pickupPostalCode === 'string') setPickupPostalCode(draft.pickupPostalCode)
        if (typeof draft.pickupCountryCode === 'string') setPickupCountryCode(draft.pickupCountryCode)
        if (typeof draft.pickupInstructions === 'string') setPickupInstructions(draft.pickupInstructions)
        if (typeof draft.deliveryAvailable === 'boolean') setDeliveryAvailable(draft.deliveryAvailable)
        if (typeof draft.shippingAvailable === 'boolean') setShippingAvailable(draft.shippingAvailable)
        if (typeof draft.identityConsentGranted === 'boolean') setIdentityConsentGranted(draft.identityConsentGranted)
      })
      .catch((error) => {
        Sentry.captureException(error, { extra: { context: 'tailor_setup_draft_restore', userId: user.id } })
      })
      .finally(() => {
        if (!cancelled) setDraftHydrated(true)
      })
    return () => { cancelled = true }
  }, [currencyHydrated, draftHydrated, profileHydrated, user?.id])

  useEffect(() => {
    if (!user?.id || !draftHydrated || draftCompletedRef.current) return
      const draft = {
        version: TAILOR_SETUP_DRAFT_VERSION,
        updatedAt: new Date().toISOString(),
        setupView,
        step,
        displayName,
        phone,
        avatarUrl,
        bio,
        location,
        languages,
        specialties,
        priceMin,
        priceMax,
        currency,
        portfolioItems,
        availability,
        sellerType,
        supportsCustomOrders,
        supportsReadyMade,
        acceptsCustomOrdersNow,
        shopPaused,
        pickupAvailable,
        pickupAddress,
        pickupCity,
        pickupRegion,
        pickupPostalCode,
        pickupCountryCode,
        pickupInstructions,
        deliveryAvailable,
        shippingAvailable,
        identityConsentGranted,
        trustVideoUri,
        trustVideoContentType,
      }
      draftSaveQueueRef.current = draftSaveQueueRef.current.catch(() => null).then(() =>
        AsyncStorage.setItem(tailorSetupDraftKey(user.id), JSON.stringify(draft))
      ).catch((error) => {
        Sentry.captureException(error, { extra: { context: 'tailor_setup_draft_save', userId: user.id } })
      })
  }, [
    acceptsCustomOrdersNow, availability, avatarUrl, bio, currency, deliveryAvailable,
    displayName, draftHydrated, identityConsentGranted, languages, location, phone,
    pickupAddress, pickupAvailable, pickupCity, pickupCountryCode, pickupInstructions,
    pickupPostalCode, pickupRegion, portfolioItems, priceMax, priceMin, sellerType,
    setupView, shippingAvailable, shopPaused, specialties, step, supportsCustomOrders, supportsReadyMade,
    trustVideoContentType, trustVideoUri, user?.id,
  ])

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false

    void fetchCurrencyPreferenceContext()
      .then((resolved) => {
        if (cancelled) return
        setCurrency(resolved.currency)
        setCurrencySource(resolved.source)
        setRegionCode(resolved.regionCode)
      })
      .finally(() => {
        if (!cancelled) setCurrencyHydrated(true)
      })

    fetchOwnTailorSetupProfile<TailorSetupProfileRow>().then(({ data, error }) => {
        if (cancelled) return
        if (error || !data) {
          setProfileHydrated(true)
          return
        }

        const row = data as TailorSetupProfileRow
        setHasPersistedProfile(true)
        const nextDisplayName = row.display_name ?? oauthName
        const nextAvatarUrl = row.avatar_url ?? null
        const nextBio = row.bio ?? ''
        const nextLocation = row.location ?? ''
        const nextLanguages = Array.isArray(row.languages)
          ? row.languages.filter(
              (item: unknown): item is string => typeof item === 'string' && item.trim().length > 0
            )
          : []
        const nextSpecialties = Array.isArray(row.specialty_tags)
          ? row.specialty_tags.filter(
              (item: unknown): item is string => typeof item === 'string' && item.trim().length > 0
            )
          : []
        const nextPhotos = Array.isArray(row.portfolio_photo_urls)
          ? row.portfolio_photo_urls
              .filter(
                (item: unknown): item is string =>
                  typeof item === 'string' && item.trim().length > 0
              )
              .map((url: string) => ({ type: 'photo' as const, url }))
          : []
        const nextTrustVideoPath = typeof row.trust_verification_video_path === 'string'
          ? row.trust_verification_video_path.trim()
          : ''
        const nextVideos = Array.isArray(row.portfolio_video_urls)
          ? row.portfolio_video_urls
              .filter(
                (item: unknown): item is string =>
                  typeof item === 'string' && item.trim().length > 0
              )
              .map((url: string) => ({ type: 'video' as const, url }))
          : []

        if (typeof nextDisplayName === 'string' && nextDisplayName.trim().length > 0) {
          setDisplayName(nextDisplayName)
        }
        if (typeof nextAvatarUrl === 'string' && nextAvatarUrl.trim().length > 0) {
          setAvatarUrl(nextAvatarUrl)
        }
        if (typeof nextBio === 'string' && nextBio.trim().length > 0) {
          setBio(nextBio)
        }
        if (typeof nextLocation === 'string' && nextLocation.trim().length > 0) {
          setLocation(nextLocation)
        }
        if (nextLanguages.length > 0) {
          setLanguages(nextLanguages.slice(0, MAX_LANGUAGE_TAGS))
        }
        if (nextSpecialties.length > 0) {
          setSpecialties(nextSpecialties.slice(0, MAX_SPECIALTY_TAGS))
        }
        if (typeof row.price_range_min === 'number' && row.price_range_min > 0) {
          setPriceMin(String(row.price_range_min / 100))
        }
        if (typeof row.price_range_max === 'number' && row.price_range_max > 0) {
          setPriceMax(String(row.price_range_max / 100))
        }
        if (
          typeof row.currency === 'string' &&
          SUPPORTED_CURRENCIES.includes(row.currency as (typeof SUPPORTED_CURRENCIES)[number])
        ) {
          setCurrency(row.currency as typeof currency)
        }
        setSavedTrustVideoPath(nextTrustVideoPath)
        setTrustChallengeId(row.trust_verification_challenge_id?.trim() ?? '')
        setTrustChallengeText(row.trust_verification_challenge_text?.trim() ?? '')
        if (nextPhotos.length > 0 || nextVideos.length > 0) {
          setPortfolioItems([...nextPhotos, ...nextVideos])
        }
        if (
          typeof row.availability === 'string' &&
          ['OPEN', 'LIMITED', 'FULLY_BOOKED'].includes(row.availability)
        ) {
          setAvailability(row.availability as Availability)
        }
        if (
          typeof row.seller_type === 'string' &&
          ['TAILOR', 'BOUTIQUE', 'TAILOR_SHOP'].includes(row.seller_type)
        ) {
          setSellerType(row.seller_type as SellerType)
        }
        if (typeof row.supports_custom_orders === 'boolean')
          setSupportsCustomOrders(row.supports_custom_orders)
        if (typeof row.supports_ready_made === 'boolean')
          setSupportsReadyMade(row.supports_ready_made)
        if (typeof row.accepts_custom_orders_now === 'boolean')
          setAcceptsCustomOrdersNow(row.accepts_custom_orders_now)
        if (typeof row.shop_paused === 'boolean') setShopPaused(row.shop_paused)
        if (typeof row.pickup_available === 'boolean') setPickupAvailable(row.pickup_available)
        if (typeof row.delivery_available === 'boolean')
          setDeliveryAvailable(row.delivery_available)
        if (typeof row.shipping_available === 'boolean')
          setShippingAvailable(row.shipping_available)
        setReadyMadeItemCount(row.ready_made_item_count ?? 0)
        if (
          typeof row.id_verification_status === 'string' &&
          ['NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'APPROVED', 'REJECTED'].includes(
            row.id_verification_status
          )
        ) {
          setIdVerificationStatus(
            row.id_verification_status === 'APPROVED'
              ? 'VERIFIED'
              : (row.id_verification_status as VerificationStatus)
          )
          if (row.id_verification_status === 'REJECTED') {
            setIdRejectionCode(readIdentityRejectionCode(row))
            setIdRejectionReason(readIdentityRejectionMessage(row))
            setAvatarRejectionCleared(false)
          } else {
            setIdRejectionCode('')
            setIdRejectionReason('')
            setAvatarRejectionCleared(false)
          }
        }
        setProfileHydrated(true)
    })

    supabase
      .from('users')
      .select('default_currency, currency_source, region_code, phone')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || !data) return

        const row = data as UserCurrencyRow
        const nextCurrency =
          typeof row.default_currency === 'string' &&
          SUPPORTED_CURRENCIES.includes(
            row.default_currency as (typeof SUPPORTED_CURRENCIES)[number]
          )
            ? (row.default_currency as typeof currency)
            : null

        if (nextCurrency) {
          setCurrency(nextCurrency)
        }
        if (
          typeof row.currency_source === 'string' &&
          row.currency_source.trim().length > 0
        ) {
          setCurrencySource(row.currency_source.trim().toUpperCase() as typeof currencySource)
        }
        if (
          typeof row.region_code === 'string' &&
          row.region_code.trim().length > 0
        ) {
          setRegionCode(row.region_code.trim().toUpperCase())
        }
        const nextPhone =
          typeof row.phone === 'string' && row.phone.trim().length > 0
            ? row.phone.trim()
            : oauthPhone
        if (nextPhone.trim().length > 0) {
          setPhone(nextPhone)
        }
      })

    supabase
      .from('tailor_pickup_details')
      .select('pickup_address, pickup_city, pickup_region, pickup_postal_code, pickup_country_code, pickup_instructions')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || !data) {
          setPickupHydrated(true)
          return
        }

        const row = data as PickupDetailsRow
        if (typeof row.pickup_address === 'string') setPickupAddress(row.pickup_address)
        if (typeof row.pickup_city === 'string') setPickupCity(row.pickup_city)
        if (typeof row.pickup_region === 'string') setPickupRegion(row.pickup_region)
        if (typeof row.pickup_postal_code === 'string') setPickupPostalCode(row.pickup_postal_code)
        if (typeof row.pickup_country_code === 'string') setPickupCountryCode(row.pickup_country_code)
        if (typeof row.pickup_instructions === 'string')
          setPickupInstructions(row.pickup_instructions)
        setPickupHydrated(true)
      })

    return () => {
      cancelled = true
    }
  }, [user?.id, oauthName, oauthPhone])

  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return undefined
      let cancelled = false

      async function refreshReadyMadeItemCount() {
        const { data } = await fetchOwnTailorSetupProfile<TailorSetupProfileRow>()

        if (cancelled) return
        setReadyMadeItemCount(data?.ready_made_item_count ?? 0)
      }

      void refreshReadyMadeItemCount()
      return () => {
        cancelled = true
      }
    }, [user?.id])
  )

  // ── Location autocomplete via Nominatim (OSM, no API key) ───────────────────

  function onLocationChange(text: string) {
    setLocation(text)
    clearVisibleError('location')
    setShowSuggestions(false)
    if (locationDebounce.current) clearTimeout(locationDebounce.current)
    if (text.trim().length < 3) {
      setLocationSuggestions([])
      return
    }
    locationDebounce.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&format=json&addressdetails=1&limit=6&featuretype=city`,
          { headers: { 'Accept-Language': 'en', 'User-Agent': 'Drapeon/1.0' } }
        )
        const data = (await res.json()) as NominatimSuggestion[]
        const labels = data
          .filter(
            (item) =>
              item && typeof item.display_name === 'string' && item.display_name.length > 0
          )
          .map((item) => {
            const displayName =
              typeof item.display_name === 'string' ? item.display_name : ''
            const a = item.address ?? {}
            const city =
              a.city ?? a.town ?? a.village ?? a.county ?? displayName.split(',')[0]
            const country = a.country ?? ''
            return country ? `${city}, ${country}` : city
          })
          .filter((label): label is string => typeof label === 'string' && label.trim().length > 0)
        const unique = [...new Set(labels)] as string[]
        setLocationSuggestions(unique)
        setShowSuggestions(unique.length > 0)
      } catch {
        // Nominatim unavailable — just let the user type freely
      }
    }, 400)
  }

  function selectLocation(suggestion: string) {
    setLocation(suggestion)
    clearVisibleError('location')
    setLocationSuggestions([])
    setShowSuggestions(false)
  }

  // ── Bio gibberish detection ──────────────────────────────────────────────────

  function isBioGibberish(text: string): boolean {
    const t = text.trim()
    // Excessive repeated characters: "hhhhhh", "aaaaaaa"
    if (/(.)\1{4,}/i.test(t)) return true
    // Actual keyboard-smash sequences (chars that run in order along a row)
    if (
      /qwert|werty|ertyu|rtyui|tyuio|yuiop|asdfg|sdfgh|dfghj|fghjk|ghjkl|zxcvb|xcvbn|cvbnm/i.test(t)
    )
      return true
    // Must contain at least 5 real words (3+ letters each)
    const words = t.match(/[a-zA-Z]{3,}/g) ?? []
    if (words.length < 5) return true
    // Vowel ratio below 15% → likely consonant mashing (real English ~38% vowels)
    const vowels = (t.match(/[aeiou]/gi) ?? []).length
    const letters = (t.match(/[a-zA-Z]/g) ?? []).length
    if (letters > 20 && vowels / letters < 0.15) return true
    // Average word length > 14 = suspiciously long tokens
    const avgLen = words.reduce((s, w) => s + w.length, 0) / words.length
    if (avgLen > 14) return true
    return false
  }

  function validateName(value: string) {
    const error = validateDisplayName(value)
    setNameError(error ?? '')
    return !error
  }

  const phoneValidationMessage = useCallback((value: string) => {
    if (!value.trim()) {
      return TAILOR_SETUP_VALIDATION.PHONE_REQUIRED_MESSAGE
    }
    const error = validatePhoneForProfile(value)
    if (error) {
      return error
    }
    return ''
  }, [])

  function validatePhone(value: string) {
    const error = phoneValidationMessage(value)
    setPhoneError(error)
    return !error
  }

  async function validatePhoneAvailability(value: string) {
    const formatError = phoneValidationMessage(value)
    const normalizedPhone = normalizePhoneForStorage(value)
    const requestId = phoneAvailabilityRequestRef.current + 1
    phoneAvailabilityRequestRef.current = requestId

    if (formatError) {
      setPhoneAvailabilityChecking(false)
      setPhoneError(formatError)
      return formatError
    }

    setPhoneAvailabilityChecking(true)
    const result = await checkAccountPhoneAvailability(normalizedPhone)

    if (
      requestId !== phoneAvailabilityRequestRef.current ||
      normalizePhoneForStorage(latestPhoneRef.current) !== normalizedPhone
    ) {
      return result.error ?? ''
    }

    setPhoneAvailabilityChecking(false)
    const availabilityError = result.available ? '' : result.error || DUPLICATE_PHONE_MESSAGE
    setPhoneError(availabilityError)
    return availabilityError
  }

  function markPhoneVerified(value: string) {
    const normalizedPhone = normalizePhoneForStorage(value)
    verifiedPhoneRef.current = normalizedPhone
    setVerifiedPhone(normalizedPhone)
    setPhoneOtpError('')
    setPhoneError('')
    clearVisibleError('phone')
  }

  function isCurrentPhoneVerified(value = phone) {
    const normalizedPhone = normalizePhoneForStorage(value)
    return !!normalizedPhone && verifiedPhoneRef.current === normalizedPhone
  }

  async function confirmPhoneSaved(normalizedPhone: string) {
    let error = await saveOnboardingPhone(normalizedPhone)
      .catch(() => 'Your phone was not saved. Please retry before continuing setup.')
    if (!error && normalizePhoneForStorage(latestPhoneRef.current) !== normalizedPhone) {
      error = 'The phone number changed while saving. Confirm the current number before continuing.'
    }
    if (!error) return true
    setPhoneError(error)
    setPhoneOtpError(error)
    setVisibleErrors({ phone: error })
    setStep(0)
    setSetupView('section')
    focusFirstSetupError({ phone: error }, 0)
    hapticWarning()
    return false
  }

  async function ensurePhoneVerifiedForSetup(afterVerify: 'advance' | 'finish') {
    const formatError = phoneValidationMessage(phone)
    const normalizedPhone = normalizePhoneForStorage(phone)
    if (formatError) {
      setPhoneError(formatError)
      setVisibleErrors({ phone: formatError })
      focusFirstSetupError({ phone: formatError }, 0)
      return false
    }

    if (isCurrentPhoneVerified(normalizedPhone)) return confirmPhoneSaved(normalizedPhone)

    setPhoneOtpSending(true)
    const result = await sendAccountPhoneOtp(normalizedPhone)
    setPhoneOtpSending(false)

    if (result.error) {
      setPhoneError(result.error)
      setVisibleErrors({ phone: result.error })
      focusFirstSetupError({ phone: result.error }, 0)
      hapticWarning()
      return false
    }

    if (result.bypassed) {
      if (!await confirmPhoneSaved(normalizedPhone)) return false
      markPhoneVerified(normalizedPhone)
      showSetupToast('Phone number saved', 'success')
      return true
    }

    phoneOtpAfterVerifyRef.current = afterVerify
    setPhoneOtpCode('')
    setPhoneOtpError('')
    setPhoneOtpVisible(true)
    showSetupToast('We sent a 6-digit code to verify your phone', 'success')
    return false
  }

  async function verifyPhoneOtpCode() {
    const normalizedPhone = normalizePhoneForStorage(phone)
    const code = phoneOtpCode.replace(/\D/g, '')
    if (code.length !== 6) {
      setPhoneOtpError('Enter the 6-digit code from the SMS.')
      hapticWarning()
      return
    }

    setPhoneOtpVerifying(true)
    const result = await verifyAccountPhoneOtp({ phone: normalizedPhone, code })
    setPhoneOtpVerifying(false)

    if (result.error) {
      setPhoneOtpError(result.error)
      hapticWarning()
      return
    }

    if (!await confirmPhoneSaved(normalizedPhone)) return
    const action = phoneOtpAfterVerifyRef.current
    phoneOtpAfterVerifyRef.current = null
    markPhoneVerified(normalizedPhone)
    setPhoneOtpVisible(false)
    setPhoneOtpCode('')
    showSetupToast(result.bypassed ? 'Phone check passed for this environment' : 'Phone number verified', 'success')
    hapticSuccess()

    requestAnimationFrame(() => {
      if (action === 'advance') {
        openSetupSection(1)
        return
      }
      if (action === 'finish') {
        void finish()
      }
    })
  }

  async function resendPhoneOtpCode() {
    const normalizedPhone = normalizePhoneForStorage(phone)
    setPhoneOtpSending(true)
    const result = await sendAccountPhoneOtp(normalizedPhone)
    setPhoneOtpSending(false)

    if (result.error) {
      setPhoneOtpError(result.error)
      hapticWarning()
      return
    }

    if (result.bypassed) {
      if (!await confirmPhoneSaved(normalizedPhone)) return
      const action = phoneOtpAfterVerifyRef.current
      phoneOtpAfterVerifyRef.current = null
      markPhoneVerified(normalizedPhone)
      setPhoneOtpVisible(false)
      setPhoneOtpCode('')
      showSetupToast('Phone check passed for this environment', 'success')
      requestAnimationFrame(() => {
        if (action === 'advance') {
          openSetupSection(1)
          return
        }
        if (action === 'finish') {
          void finish()
        }
      })
      return
    }

    setPhoneOtpError('')
    showSetupToast('Code resent', 'success')
  }

  useEffect(() => {
    latestPhoneRef.current = phone

    const formatError = phoneValidationMessage(phone)
    const requestId = phoneAvailabilityRequestRef.current + 1
    phoneAvailabilityRequestRef.current = requestId

    if (!phone.trim() || formatError) {
      return undefined
    }

    const normalizedPhone = normalizePhoneForStorage(phone)
    const timer = setTimeout(() => {
      setPhoneAvailabilityChecking(true)
      void checkAccountPhoneAvailability(normalizedPhone).then((result) => {
        if (
          requestId !== phoneAvailabilityRequestRef.current ||
          normalizePhoneForStorage(latestPhoneRef.current) !== normalizedPhone
        ) {
          return
        }

        setPhoneAvailabilityChecking(false)
        setPhoneError(result.available ? '' : result.error || DUPLICATE_PHONE_MESSAGE)
      })
    }, PHONE_AVAILABILITY_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [phone, phoneValidationMessage])

  function getBioValidationError(text: string) {
    const res = filterContactInfo(text)
    if (res.blocked) {
      return "Contact details aren't allowed in your bio."
    }
    if (text.trim().length < 80) {
      return `About you needs at least 80 characters (${text.trim().length}/80).`
    }
    if (isBioGibberish(text)) {
      return 'Please enter a meaningful description of your work and experience.'
    }
    return ''
  }

  function validateBio(text: string) {
    const error = getBioValidationError(text)
    setBioError(error)
    return !error
  }

  const profileImageRejectionActive =
    idVerificationStatus === 'REJECTED' &&
    isProfileImageRejectionCode(idRejectionCode) &&
    !avatarRejectionCleared
  const portfolioRejectionActive =
    idVerificationStatus === 'REJECTED' && isPortfolioMediaRejectionCode(idRejectionCode)

  const hasTrustVideoForSetup = useCallback(() => {
    if (trustVideoUri) return true
    if (
      (isProfileImageRejectionCode(idRejectionCode) || isPortfolioMediaRejectionCode(idRejectionCode))
      && savedTrustVideoPath
    ) return true
    return idVerificationStatus !== 'NOT_SUBMITTED' && idVerificationStatus !== 'REJECTED'
  }, [idRejectionCode, idVerificationStatus, savedTrustVideoPath, trustVideoUri])

  const getSetupProgress = useCallback((overrides?: {
    nameError?: string
    phoneError?: string
    bioError?: string
    idDocumentPresent?: boolean
  }) => {
    return deriveTailorSetupProgress({
      displayName,
      nameError: overrides?.nameError ?? nameError,
      phone,
      phoneError: overrides?.phoneError ?? phoneError,
      profilePhotoPresent: !!avatarUrl && !profileImageRejectionActive,
      location,
      bio,
      bioError: overrides?.bioError ?? bioError,
      bioLooksInvalid: bio.trim().length > 0 && isBioGibberish(bio),
      languages,
      specialties,
      priceMin,
      priceMax,
      currency,
      portfolioItemCount: portfolioItems.length,
      readyMadeItemCount,
      sellerType,
      supportsCustomOrders,
      supportsReadyMade,
      pickupAvailable,
      deliveryAvailable,
      shippingAvailable,
      pickupAddress,
      idDocumentPresent: overrides?.idDocumentPresent ?? hasTrustVideoForSetup(),
    })
  }, [
    displayName,
    nameError,
    phone,
    phoneError,
    avatarUrl,
    profileImageRejectionActive,
    location,
    bio,
    bioError,
    languages,
    specialties,
    priceMin,
    priceMax,
    currency,
    portfolioItems.length,
    readyMadeItemCount,
    sellerType,
    supportsCustomOrders,
    supportsReadyMade,
    pickupAvailable,
    deliveryAvailable,
    shippingAvailable,
    pickupAddress,
    hasTrustVideoForSetup,
  ])

  function applySellerType(nextType: SellerType) {
    setSellerType(nextType)
    if (nextType === 'BOUTIQUE') {
      setSupportsCustomOrders(false)
      setSupportsReadyMade(true)
      setAcceptsCustomOrdersNow(false)
      setShopPaused(false)
    } else if (nextType === 'TAILOR_SHOP') {
      setSupportsCustomOrders(true)
      setSupportsReadyMade(true)
      setAcceptsCustomOrdersNow(true)
      setShopPaused(false)
    } else {
      setSupportsCustomOrders(true)
      setSupportsReadyMade(false)
      setAcceptsCustomOrdersNow(true)
      setShopPaused(true)
    }
    clearVisibleError('orderMode')
    clearVisibleError('portfolio')
  }

  function clearVisibleError(field: TailorSetupField) {
    setVisibleErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
    setSetupToast((current) => (current?.type === 'error' ? null : current))
  }

  const rememberSetupFieldY = useCallback((field: TailorSetupField) => {
    return (event: { nativeEvent: { layout: { y: number } } }) => {
      setupFieldYRef.current[field] = event.nativeEvent.layout.y
    }
  }, [])

  const showSetupToast = useCallback(
    (message: string, type: SetupToast['type'] = 'success', autoDismiss = type === 'success') => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
      if (setupToastTimerRef.current) {
        clearTimeout(setupToastTimerRef.current)
        setupToastTimerRef.current = null
      }
      setSetupToast({ type, message })
      if (autoDismiss) {
        setupToastTimerRef.current = setTimeout(() => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
          setSetupToast(null)
          setupToastTimerRef.current = null
        }, 2200)
      }
    },
    []
  )

  const scrollSetupFieldIntoView = useCallback((field: TailorSetupField) => {
    Keyboard.dismiss()
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    setFocusedTextField(null)
    hapticWarning()
    setTimeout(() => {
      const y = setupFieldYRef.current[field] ?? 0
      scrollRef.current?.scrollTo({
        y: Math.max(0, y - FOCUSED_FIELD_TOP_OFFSET),
        animated: true,
      })
    }, FOCUSED_FIELD_SCROLL_DELAY_MS)
  }, [])

  const focusFirstSetupError = useCallback(
    (errors: TailorSetupFieldErrors, currentStep: TailorSetupStep) => {
      const priority = SETUP_ERROR_FIELD_PRIORITY[currentStep]
      const field = priority.find((candidate) => errors[candidate]) ?? priority[0]
      const message = (field && errors[field]) || 'Finish the highlighted section to continue.'
      showSetupToast(message, 'error', false)
      if (field) {
        scrollSetupFieldIntoView(field)
      } else {
        hapticWarning()
      }
    },
    [scrollSetupFieldIntoView, showSetupToast]
  )

  useEffect(() => {
    if (initialStepResolved.current || !profileHydrated || !pickupHydrated) return
    initialStepResolved.current = true
    if (openIdentityFromHandoff) {
      openSetupSection(3)
      showSetupToast('Secure handoff opened. Record your short trust video.', 'success')
      return
    }
    const progress = getSetupProgress()
    if (routeRequestedStep !== null) {
      openSetupSection(progress.firstIncompleteStep)
      return
    }
    setStep(progress.firstIncompleteStep)
  }, [getSetupProgress, openIdentityFromHandoff, pickupHydrated, profileHydrated, routeRequestedStep, showSetupToast])

  useEffect(() => {
    if (!profileHydrated || !pickupHydrated || routeRequestedStep === null) return
    const restoreKey = `section:${routeRequestedStep}`
    if (routeSectionRestoreKey.current === restoreKey) return
    routeSectionRestoreKey.current = restoreKey
    const progress = getSetupProgress()
    openSetupSection(progress.firstIncompleteStep)
  }, [getSetupProgress, pickupHydrated, profileHydrated, routeRequestedStep])

  function openProfilePhotoPicker() {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    setFocusedTextField(null)
    setMediaSheetMode('profile-photo')
  }

  async function pickProfilePhoto(source: ProfilePhotoSource) {
    const imageUri = await pickAvatarImageUri(source)
    if (!imageUri || !user?.id) return

    setUploadingAvatar(true)
    try {
      const compressed = await ImageManipulator.manipulateAsync(
        imageUri,
        [{ resize: { width: 800, height: 800 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
      )
      const publicUrl = await uploadPublicStorageImage({
        bucket: 'avatars',
        path: `${user.id}/avatar.jpg`,
        uri: compressed.uri,
        contentType: 'image/jpeg',
        maxBytes: 5 * 1024 * 1024,
        upsert: true,
      })
      setAvatarUrl(`${publicUrl}?t=${new Date().getTime()}`)
      if (isProfileImageRejectionCode(idRejectionCode)) setAvatarRejectionCleared(true)
      clearVisibleError('profilePhoto')
    } catch (error) {
      Sentry.captureException(error, {
        extra: { context: 'tailor_setup_avatar_upload', userId: user?.id },
      })
      Alert.alert(
        'Could not add profile photo',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. Your setup details are still here, so retry the photo when the signal improves.'
          : 'We could not upload this photo right now. Please try again in a moment.'
      )
    } finally {
      setUploadingAvatar(false)
    }
  }

  function openPortfolioMediaPicker() {
    setPortfolioReplaceIndex(null)
    setMediaSheetMode('portfolio-media')
  }

  function openPortfolioReplacePicker(index: number) {
    setPortfolioReplaceIndex(index)
    setSelectedPortfolioIndex(null)
    setMediaSheetMode('portfolio-media')
  }

  function syncPortfolioMediaOrder(nextItems: PortfolioItem[]) {
    if (!user?.id) return
    void invokeFunction('tailor-profile-action', {
      body: {
        action: 'update-portfolio-media',
        photoUrls: nextItems.filter((item) => item.type === 'photo').map((item) => item.url),
        videoUrls: nextItems.filter((item) => item.type === 'video').map((item) => item.url),
      },
    }).then(({ error }) => {
      if (error) {
        Sentry.captureException(error, {
          extra: { context: 'tailor_setup_portfolio_media_order_sync', userId: user?.id },
        })
      }
    }).catch((error) => {
      Sentry.captureException(error, {
        extra: { context: 'tailor_setup_portfolio_media_order_sync', userId: user?.id },
      })
    })
  }

  function movePortfolioItem(fromIndex: number, toIndex: number) {
    let reorderedItems: PortfolioItem[] | null = null
    setPortfolioItems((prev) => {
      if (
        fromIndex < 0 ||
        fromIndex >= prev.length ||
        toIndex < 0 ||
        toIndex >= prev.length ||
        fromIndex === toIndex
      ) {
        return prev
      }
      const next = [...prev]
      const [item] = next.splice(fromIndex, 1)
      if (!item) return prev
      next.splice(toIndex, 0, item)
      reorderedItems = next
      return next
    })
    if (reorderedItems) syncPortfolioMediaOrder(reorderedItems)
    setSelectedPortfolioIndex(toIndex)
    setPortfolioDragIndex(null)
    setPortfolioHoverIndex(null)
    clearVisibleError('portfolio')
  }

  function handlePortfolioDragMove(fromIndex: number, dx: number, dy: number) {
    const targetIndex = getPortfolioDropTargetIndex(fromIndex, dx, dy, portfolioItems.length)
    if (targetIndex == null) return
    setPortfolioHoverIndex((current) => current === targetIndex ? current : targetIndex)
  }

  function handlePortfolioDragEnd(fromIndex: number, dx: number, dy: number) {
    const targetIndex = getPortfolioDropTargetIndex(fromIndex, dx, dy, portfolioItems.length)
    if (targetIndex != null && targetIndex !== fromIndex) {
      movePortfolioItem(fromIndex, targetIndex)
      hapticSuccess()
      return
    }
    setPortfolioDragIndex(null)
    setPortfolioHoverIndex(null)
  }

  function removePortfolioItem(index: number) {
    let nextItems: PortfolioItem[] = []
    setPortfolioItems((prev) => {
      nextItems = prev.filter((_, idx) => idx !== index)
      return nextItems
    })
    syncPortfolioMediaOrder(nextItems)
    setSelectedPortfolioIndex(null)
    clearVisibleError('portfolio')
  }

  async function uploadPortfolioAsset(
    asset: ImagePicker.ImagePickerAsset,
    index: number
  ): Promise<PortfolioItem> {
    if (!user?.id) {
      throw new Error('Session expired. Please sign in again.')
    }

    const isVideo = asset.type === 'video'
    const stamp = `${new Date().getTime()}-${index}`

    if (isVideo) {
      const extension = portfolioVideoExtension(asset)
      const filename = `portfolio/${user.id}/${stamp}.${extension}`
      const contentType = portfolioVideoContentType(asset)
      const payload = await createValidatedUploadPayload(asset.uri, {
        maxBytes: MAX_PORTFOLIO_VIDEO_BYTES,
        contentType,
        allowedContentTypes: ALLOWED_VIDEO_CONTENT_TYPES,
        purpose: 'PORTFOLIO',
      })
      const { error: videoError } = await supabase.storage
        .from('portfolio-photos')
        .upload(filename, payload.data, { contentType, cacheControl: MEDIA_CACHE_CONTROL_SECONDS.publicImmutable })
      if (videoError) throw videoError
      const { data } = supabase.storage.from('portfolio-photos').getPublicUrl(filename)
      return { type: 'video', url: data.publicUrl }
    }

    const uri = await stripExif(asset.uri, { maxWidth: 1400 })
    const filename = `portfolio/${user.id}/${stamp}.jpg`
    const publicUrl = await uploadPublicStorageImage({
      bucket: 'portfolio-photos',
      path: filename,
      uri,
      contentType: 'image/jpeg',
      maxBytes: 10 * 1024 * 1024,
    })
    return { type: 'photo', url: publicUrl }
  }

  async function pickPortfolioMedia(source: PortfolioMediaSource) {
    const replacingIndex =
      portfolioReplaceIndex != null &&
      portfolioReplaceIndex >= 0 &&
      portfolioReplaceIndex < portfolioItems.length
        ? portfolioReplaceIndex
        : null
    const replacingItem = replacingIndex != null ? portfolioItems[replacingIndex] : null
    const isReplacing = replacingIndex != null

    if (!isReplacing && portfolioItems.length >= MAX_PORTFOLIO_ITEMS) {
      Alert.alert('Maximum reached', `You can add up to ${MAX_PORTFOLIO_ITEMS} photos or videos.`)
      return
    }
    const videoCount =
      portfolioItems.filter((i) => i.type === 'video').length -
      (replacingItem?.type === 'video' ? 1 : 0)
    if (source === 'camera-video' && videoCount >= MAX_PORTFOLIO_VIDEOS) {
      Alert.alert(
        'Video limit',
        `You can include up to ${MAX_PORTFOLIO_VIDEOS} videos in your portfolio.`
      )
      return
    }

    const permission =
      source === 'library'
        ? await ImagePicker.requestMediaLibraryPermissionsAsync()
        : await ImagePicker.requestCameraPermissionsAsync()
    if (!permission.granted) {
      Alert.alert(
        'Permission needed',
        source === 'library'
          ? 'Allow photo access to choose portfolio media.'
          : 'Allow camera access to capture portfolio media.'
      )
      return
    }

    if (source !== 'camera-photo') {
      setPortfolioMediaStatus(
        source === 'library'
          ? 'Preparing selected media. Videos can take a few seconds.'
          : 'Preparing video. This can take a few seconds.'
      )
    }

    const res = await launchImagePickerSafely(
      () =>
        source === 'library'
          ? ImagePicker.launchImageLibraryAsync(
              preferCompatibleVideoRepresentation({
                mediaTypes: ['images', 'videos'],
                allowsMultipleSelection: !isReplacing,
                orderedSelection: true,
                selectionLimit: Math.min(
                  isReplacing ? 1 : MAX_PORTFOLIO_ITEMS - portfolioItems.length,
                  MAX_PORTFOLIO_ITEMS
                ),
                quality: 0.85,
                videoMaxDuration: MAX_PORTFOLIO_VIDEO_SECONDS,
              })
            )
          : source === 'camera-video'
            ? ImagePicker.launchCameraAsync({
                mediaTypes: 'videos',
                quality: 0.8,
                videoMaxDuration: MAX_PORTFOLIO_VIDEO_SECONDS,
              })
            : ImagePicker.launchCameraAsync({
                mediaTypes: 'images',
                quality: 0.85,
              }),
      {
        context: 'tailor_setup_portfolio_media_picker',
        mediaLabel: source === 'library' ? 'portfolio media file' : 'portfolio media',
        extra: { source, userId: user?.id },
      }
    )
    if (!res) {
      setPortfolioMediaStatus(null)
      setPortfolioReplaceIndex(null)
      return
    }
    if (res.canceled || !res.assets[0]) {
      setPortfolioMediaStatus(null)
      setPortfolioReplaceIndex(null)
      return
    }

    const remainingSlots = isReplacing ? 1 : MAX_PORTFOLIO_ITEMS - portfolioItems.length
    const candidates = res.assets.slice(0, remainingSlots)
    const acceptedAssets: ImagePicker.ImagePickerAsset[] = []
    let skippedDuplicates = 0
    let skippedVideos = 0
    const validationMessages = new Set<string>()
    let nextVideoCount = videoCount
    const seenAssetKeys = new Set(pickedAssetKeys.current)

    for (const asset of candidates) {
      const duplicateKey = portfolioAssetDuplicateKey(asset)
      if (pickedUris.current.has(asset.uri) || seenAssetKeys.has(duplicateKey)) {
        skippedDuplicates += 1
        continue
      }
      if (asset.type === 'video') {
        const validationMessage = validatePortfolioVideoAsset(asset)
        if (validationMessage) {
          validationMessages.add(validationMessage)
          continue
        }
        if (nextVideoCount >= MAX_PORTFOLIO_VIDEOS) {
          skippedVideos += 1
          continue
        }
        nextVideoCount += 1
      }
      acceptedAssets.push(asset)
      seenAssetKeys.add(duplicateKey)
    }

    if (acceptedAssets.length === 0) {
      setPortfolioMediaStatus(null)
      setPortfolioReplaceIndex(null)
      const reason = validationMessages.size
        ? Array.from(validationMessages)[0]
        : skippedDuplicates > 0
          ? 'Those files are already in your portfolio.'
          : `You can include up to ${MAX_PORTFOLIO_VIDEOS} videos in your portfolio.`
      Alert.alert('Nothing added', reason)
      return
    }

    setUploadingMedia(true)
    setPortfolioMediaStatus(
      acceptedAssets.some((asset) => asset.type === 'video')
        ? 'Uploading video. Keep this screen open.'
        : 'Uploading media. Keep this screen open.'
    )
    acceptedAssets.forEach((asset) => {
      pickedUris.current.add(asset.uri)
      pickedAssetKeys.current.add(portfolioAssetDuplicateKey(asset))
    })

    const uploadedItems: PortfolioItem[] = []
    const failedAssets: ImagePicker.ImagePickerAsset[] = []
    try {
      for (let i = 0; i < acceptedAssets.length; i += 1) {
        try {
          uploadedItems.push(await uploadPortfolioAsset(acceptedAssets[i], i))
        } catch (assetError) {
          failedAssets.push(acceptedAssets[i])
          pickedUris.current.delete(acceptedAssets[i].uri)
          pickedAssetKeys.current.delete(portfolioAssetDuplicateKey(acceptedAssets[i]))
          Sentry.captureException(assetError, {
            extra: { context: 'tailor_setup_media_asset_upload', userId: user?.id },
          })
        }
      }

      if (uploadedItems.length > 0) {
        if (isReplacing && uploadedItems[0]) {
          setPortfolioItems((prev) =>
            prev.map((item, idx) => (idx === replacingIndex ? uploadedItems[0] : item))
          )
          setSelectedPortfolioIndex(replacingIndex)
        } else {
          setPortfolioItems((prev) => [...prev, ...uploadedItems].slice(0, MAX_PORTFOLIO_ITEMS))
        }
        clearVisibleError('portfolio')
      }

      if (
        failedAssets.length > 0 ||
        skippedDuplicates > 0 ||
        skippedVideos > 0 ||
        validationMessages.size > 0 ||
        res.assets.length > candidates.length
      ) {
        const notes = [
          uploadedItems.length > 0 ? `${uploadedItems.length} added` : null,
          failedAssets.length > 0 ? `${failedAssets.length} failed` : null,
          skippedDuplicates > 0 ? `${skippedDuplicates} duplicate` : null,
          skippedVideos > 0 ? `${skippedVideos} over video limit` : null,
          validationMessages.size > 0 ? Array.from(validationMessages)[0] : null,
          res.assets.length > candidates.length
            ? `${res.assets.length - candidates.length} over portfolio limit`
            : null,
        ].filter(Boolean)
        Alert.alert('Portfolio update', notes.join(' · '))
      }
    } catch (error) {
      const capturedError = error as ErrorWithStatus
      acceptedAssets.forEach((asset) => {
        pickedUris.current.delete(asset.uri)
        pickedAssetKeys.current.delete(portfolioAssetDuplicateKey(asset))
      })
      const details = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not upload this media yet. Retry from this setup step when the signal improves.'
        : 'We could not upload this media right now. Please try again in a moment.'
      Sentry.captureException(error, {
        extra: {
          context: 'tailor_setup_media_upload',
          userId: user?.id,
          statusCode: capturedError.statusCode,
          name: capturedError.name,
        },
      })
      Alert.alert('Could not upload media', details)
    } finally {
      setUploadingMedia(false)
      setPortfolioMediaStatus(null)
      setPortfolioReplaceIndex(null)
    }
  }

  async function openTrustVideoPicker() {
    if (trustChallengeLoading) return
    setTrustChallengeLoading(true)
    try {
      if (!hasPersistedProfile) {
        const { error } = await persistSetupProfile()
        if (error) throw error
        setHasPersistedProfile(true)
      }
      await ensureTrustVideoSession()
      setMediaSheetMode('trust-video')
    } catch (sessionError) {
      Sentry.captureException(sessionError, {
        extra: { context: 'tailor_setup_identity_handoff_create', userId: user?.id },
      })
      Alert.alert(
        'Trust video unavailable',
        await readFunctionErrorMessage(sessionError, 'Could not load your private challenge. Please try again.')
      )
    } finally {
      setTrustChallengeLoading(false)
    }
  }

  function currentSetupProfilePayload() {
    return {
      displayName: displayName.trim(),
      avatarUrl,
      bio: bio.trim() || null,
      location: location.trim(),
      languages: languages.slice(0, MAX_LANGUAGE_TAGS),
      specialties: specialties.slice(0, MAX_SPECIALTY_TAGS),
      priceRangeMin: priceMin ? Math.round(parseTailorPriceMajor(priceMin) * 100) : null,
      priceRangeMax: priceMax ? Math.round(parseTailorPriceMajor(priceMax) * 100) : null,
      currency,
      portfolioPhotoUrls: portfolioItems.filter((i) => i.type === 'photo').map((i) => i.url),
      portfolioVideoUrls: portfolioItems.filter((i) => i.type === 'video').map((i) => i.url),
      availability,
      sellerType,
      supportsCustomOrders,
      supportsReadyMade,
      acceptsCustomOrdersNow,
      shopPaused,
      pickupAvailable,
      pickupAddress: pickupAddress.trim() || null,
      pickupAddressLine1: pickupAddress.trim() || null,
      pickupCity: pickupCity.trim() || null,
      pickupRegion: pickupRegion.trim() || null,
      pickupPostalCode: pickupPostalCode.trim() || null,
      pickupCountryCode: pickupCountryCode.trim().toUpperCase() || null,
      pickupLocationVerificationSource: pickupAvailable || deliveryAvailable || shippingAvailable ? 'TAILOR_CONFIRMED_STRUCTURED' : null,
      pickupLocationVerificationReference: null,
      pickupLocationVerifiedAt: pickupAvailable || deliveryAvailable || shippingAvailable ? new Date().toISOString() : null,
      pickupInstructions: pickupInstructions.trim() || null,
      deliveryAvailable,
      shippingAvailable,
      deliveryFee: 0,
      shippingFee: 0,
    }
  }

  function persistSetupProfile() {
    return invokeFunction('tailor-profile-action', {
      body: {
        action: 'upsert-setup',
        profile: currentSetupProfilePayload(),
      },
    })
  }

  async function syncTailorCurrencyWithRetry() {
    let lastError: Error | null = null

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { error } = await invokeFunction('account-profile-action', {
        body: {
          action: 'update-currency',
          role: 'TAILOR',
          currency,
          source: currencySource,
          regionCode,
        },
      })

      if (!error) return
      lastError = error

      if (attempt < 2) {
        // Keep retries bounded and add jitter so a flaky network does not make
        // every onboarding client retry at the same instant.
        await new Promise((resolve) => setTimeout(resolve, currencySyncRetryDelayMs(attempt)))
      }
    }

    throw lastError ?? new Error('We could not save your currency right now.')
  }

  async function ensureTrustVideoSession() {
    if (trustHandoffToken) {
      const resolved = await invokeFunction<{
        handoffId?: string
        challengeId?: string | null
        challengeText?: string | null
      }>('identity-handoff-action', {
        body: { action: 'resolve-token', token: trustHandoffToken },
      })
      if (resolved.error) throw resolved.error
      if (!resolved.data?.handoffId || !resolved.data.challengeId || !resolved.data.challengeText) {
        throw new Error('Trust-video challenge could not be loaded. Start a new session and try again.')
      }
      setTrustChallengeId(resolved.data.challengeId)
      setTrustChallengeText(resolved.data.challengeText)
      return trustHandoffToken
    }

    const created = await invokeFunction<{
      token?: string
      challengeId?: string
      challengeText?: string
    }>('identity-handoff-action', {
      body: { action: 'create' },
    })
    if (created.error) throw created.error
    const token = created.data?.token?.trim() || ''
    const challengeId = created.data?.challengeId?.trim() || ''
    const challengeText = created.data?.challengeText?.trim() || ''
    if (!token || !challengeId || !challengeText) {
      throw new Error('Could not start trust verification. Try again.')
    }
    setTrustHandoffToken(token)
    setTrustChallengeId(challengeId)
    setTrustChallengeText(challengeText)
    return token
  }

  async function pickTrustVideo(_source: TrustVideoSource) {
    const permission = await ImagePicker.requestCameraPermissionsAsync()
    if (!permission.granted) {
      Alert.alert(
        'Permission needed',
        'Allow camera access to record your short Drapeon trust video.'
      )
      return
    }

    const microphonePermission = await requestRecordingPermissionsAsync()
    if (!microphonePermission.granted) {
      Alert.alert('Microphone needed', 'Allow microphone access so reviewers can hear the challenge phrase.')
      return
    }

    try {
      await ensureTrustVideoSession()
    } catch (sessionError) {
      Alert.alert(
        'Trust video unavailable',
        await readFunctionErrorMessage(sessionError, 'Could not load your private challenge. Please try again.')
      )
      return
    }

    const res = await launchImagePickerSafely(
      () =>
        ImagePicker.launchCameraAsync(preferCompatibleVideoRepresentation({
          mediaTypes: 'videos',
          videoMaxDuration: TAILOR_TRUST_VIDEO_MAX_SECONDS,
          videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
          allowsEditing: false,
        })),
      {
        context: 'tailor_setup_trust_video_picker',
        mediaLabel: 'trust video',
        extra: { source: 'camera', userId: user?.id },
      }
    )
    if (!res) return
    if (res.canceled || !res.assets[0]) return
    const asset = res.assets[0]
    const durationSeconds = pickerVideoDurationSeconds(asset)
    if (durationSeconds != null && durationSeconds < TAILOR_TRUST_VIDEO_MIN_SECONDS) {
      Alert.alert(
        'Video is too short',
        `Record for at least ${TAILOR_TRUST_VIDEO_MIN_SECONDS} seconds so your face, voice, and challenge phrase are clear.`
      )
      return
    }
    if (durationSeconds != null && durationSeconds > TAILOR_TRUST_VIDEO_MAX_SECONDS + 0.5) {
      Alert.alert('Video is too long', `Keep the challenge video under ${TAILOR_TRUST_VIDEO_MAX_SECONDS} seconds.`)
      return
    }
    const contentType = portfolioVideoContentType(asset)
    if (contentType !== 'video/mp4' && contentType !== 'video/quicktime') {
      Alert.alert('Video format unsupported', 'Record the challenge again using your phone camera.')
      return
    }
    const previousTrustVideoUri = trustVideoUri
    let draftVideoUri = asset.uri
    if (user?.id) {
      try {
        draftVideoUri = await persistTrustVideoDraft(asset.uri, user.id, contentType)
        if (draftVideoUri !== previousTrustVideoUri) {
          await removeTrustVideoDraft(previousTrustVideoUri)
        }
      } catch (draftError) {
        // Keep the just-recorded asset usable for the current session, but
        // surface the durability failure so the tailor knows not to leave
        // setup before submitting the video.
        Sentry.captureException(draftError, {
          extra: { context: 'tailor_setup_trust_video_draft_copy', userId: user.id },
        })
        Alert.alert(
          'Keep setup open',
          'Your video is ready for this session, but we could not save a resumable local copy. Submit setup before leaving this screen.',
        )
      }
    }
    setTrustVideoContentType(contentType)
    setTrustVideoUri(draftVideoUri)
    // A new recording replaces previously submitted evidence. Keep the local
    // recording as the source of truth until this submission persists it.
    setSavedTrustVideoPath('')
    clearVisibleError('idDocument')
    setIdError('')
  }

  async function submitTrustVideoForReview(): Promise<boolean> {
    if (!trustVideoUri || !user?.id) return false
    if (!identityConsentGranted) {
      setIdentityConsentError('Consent is required before trust review can begin.')
      return false
    }
    setUploadingId(true)
    try {
      const token = await ensureTrustVideoSession()

      const upload = await invokeFunction<{
        path?: string
        uploadToken?: string
      }>('identity-handoff-action', {
        body: { action: 'create-upload-url', token, contentType: trustVideoContentType },
      })
      if (upload.error) throw upload.error
      const path = upload.data?.path
      const uploadToken = upload.data?.uploadToken
      if (!path || !uploadToken) throw new Error('Could not prepare secure video upload. Try again.')

      const payload = await createValidatedUploadPayload(trustVideoUri, {
        maxBytes: 50 * 1024 * 1024,
        contentType: trustVideoContentType,
        allowedContentTypes: ['video/mp4', 'video/quicktime'],
        purpose: 'TRUST_VERIFICATION',
      })
      const { error: uploadError } = await supabase.storage
        .from('trust-verification')
        .uploadToSignedUrl(path, uploadToken, payload.data, { contentType: trustVideoContentType })
      if (uploadError) throw uploadError

      const submitted = await invokeFunction<{
        status?: string
      }>('identity-handoff-action', {
        body: {
          action: 'submit',
          token,
          storagePath: path,
          consentGranted: true,
          consentVersion: IDENTITY_CONSENT_POLICY_VERSION,
          consentSource: 'MOBILE_SETUP',
          locale: Intl.DateTimeFormat().resolvedOptions().locale,
        },
      })
      if (submitted.error) throw submitted.error

      setIdVerificationStatus('PENDING')
      // The video is now durable in Supabase. A later setup failure must not
      // make the tailor record the same evidence again.
      setSavedTrustVideoPath(path)
      setIdRejectionReason('')
      setUploadingId(false)
      return true
    } catch (error) {
      Sentry.captureException(error, {
        extra: { context: 'tailor_setup_identity_handoff_submit', userId: user?.id },
      })
      setUploadingId(false)
      Alert.alert(
        'Trust review not submitted',
        await readFunctionErrorMessage(
          error,
          'We saved your profile, but the private challenge video still needs to upload before review can start.'
        )
      )
      return false
    }
  }

  function openReadyMadeItemCreator() {
    const setupReturnPath = '/(tailor)/profile/setup?view=section&step=2' as const
    const historyChain = appendToHistory(firstParam(routeParams.historyChain), setupReturnPath)
    const readyMadeItemRoute: Href = {
      pathname: '/(tailor)/shop/new',
      params: {
        returnTo: setupReturnPath,
        historyChain,
        onboarding: 'tailor_setup',
      },
    }

    router.push(readyMadeItemRoute)
  }

  async function finish() {
    if (saving || uploadingId || uploadingMedia) return

    const requiresFulfillmentOrigin = pickupAvailable || deliveryAvailable || shippingAvailable
    if (requiresFulfillmentOrigin && (
      pickupAddress.trim().length < 8
      || !pickupCity.trim()
      || !/^[A-Za-z]{2}$/u.test(pickupCountryCode.trim())
    )) {
      setStep(3)
      setSetupView('section')
      const originError = 'Add the fulfillment origin address, city, and 2-letter country code before offering pickup, delivery, or shipping.'
      setVisibleErrors({ pickupAddress: originError })
      focusFirstSetupError({ pickupAddress: originError }, 3)
      return
    }

    const phoneVerifiedForSubmit = await ensurePhoneVerifiedForSetup('finish')
    if (!phoneVerifiedForSubmit) {
      setStep(0)
      setSetupView('section')
      return
    }

    if (!hasTrustVideoForSetup()) {
      setStep(3)
      setSetupView('section')
      setIdError(TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE)
      setVisibleErrors({ idDocument: TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE })
      focusFirstSetupError({ idDocument: TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE }, 3)
      return
    }

    if (trustVideoUri && !identityConsentGranted) {
      setStep(3)
      setSetupView('section')
      setIdentityConsentError('Consent is required before trust review can begin.')
      return
    }

    setSaving(true)

    if (!user?.id) {
      setSaving(false)
      Alert.alert('Session expired', 'Please sign in again and retry profile setup.')
      return
    }

    const normalizedPhone = normalizePhoneForStorage(phone)

    const { error } = await persistSetupProfile()

    setSaving(false)

    if (error) {
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not save your setup yet. Your details are still here, so retry when the signal improves.'
        : await readFunctionErrorMessage(
            error,
            'Could not save your profile right now. Please try again in a moment.'
          )
      if (message.includes(TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE)) {
        setStep(3)
        setSetupView('section')
        setIdError(TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE)
        setVisibleErrors({ idDocument: TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE })
        focusFirstSetupError({ idDocument: TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE }, 3)
      }
      Sentry.captureException(error, {
        extra: {
          context: 'tailor_setup_submit',
          step,
          userId: user.id,
          pickupAvailable,
          deliveryAvailable,
          shippingAvailable,
          supportsCustomOrders,
          supportsReadyMade,
        },
      })
      Alert.alert('Setup not saved', message)
      return
    }
    setHasPersistedProfile(true)

    const { error: authError } = await supabase.auth.updateUser({
      data: {
        display_name: displayName.trim(),
      },
    })

    if (authError) {
      // Auth metadata is a mirror of the profile, not a prerequisite for
      // trust review or currency locking. Record the failure and let the
      // durable setup steps continue so a transient auth call cannot strand
      // the tailor's video.
      Sentry.captureException(authError, {
        extra: { context: 'tailor_setup_auth_metadata_sync', userId: user.id },
      })
    }

    if (!trustVideoUri && isProfileImageRejectionCode(idRejectionCode) && avatarRejectionCleared) {
      setIdVerificationStatus('PENDING')
      setIdRejectionReason('')
      setIdRejectionCode('')
    }

    // Submit private evidence before account-currency bookkeeping. A currency
    // failure must never strand the recording or ask for a second capture.
    if (trustVideoUri && !savedTrustVideoPath) {
      const trustVideoSubmitted = await submitTrustVideoForReview()
      if (!trustVideoSubmitted) {
        setStep(3)
        setSetupView('section')
        return
      }
    }

    try {
      await syncTailorCurrencyWithRetry()
    } catch (syncError) {
      Sentry.captureException(syncError, {
        extra: {
          context: 'tailor_setup_currency_sync',
          userId: user.id,
          currency,
          currencySource,
          regionCode,
          trustVideoPersisted: Boolean(savedTrustVideoPath || trustVideoUri),
        },
      })
      Alert.alert(
        'Profile saved',
        isLikelyConnectivityIssue(syncError)
          ? 'Your profile and trust video are saved. Currency setup is still pending because this network could not confirm it. Reopen setup and tap Submit setup again—no re-recording is needed.'
          : 'Your profile and trust video are saved. Currency setup is still pending. Reopen setup and tap Submit setup again—no re-recording is needed.'
      )
      return
    }

    await removeTrustVideoDraft(trustVideoUri).catch((draftError) => {
      Sentry.captureException(draftError, {
        extra: { context: 'tailor_setup_trust_video_draft_clear', userId: user.id },
      })
    })

    draftCompletedRef.current = true
    await draftSaveQueueRef.current
    await AsyncStorage.removeItem(tailorSetupDraftKey(user.id)).catch((draftError) => {
      Sentry.captureException(draftError, {
        extra: { context: 'tailor_setup_draft_clear', userId: user.id },
      })
    })

    Alert.alert(
      'Profile submitted',
      authError && trustVideoUri
        ? 'Your profile and trust video are submitted. We could not refresh your account contact details, but you can continue and retry them from profile settings.'
        : authError
          ? 'Your profile is submitted. We could not refresh your account contact details, but you can continue and retry them from profile settings.'
          : hasTrustVideoForSetup()
            ? "We'll review your private trust video within 24 hours. You'll be notified when your profile goes live."
            : 'Your profile is saved. Record your private trust video to submit for review. Your payout provider handles payout verification separately.',
      [{ text: 'OK', onPress: () => resetTo(router, { pathname: '/(auth)/onboarding', params: { role: 'TAILOR', userId: user.id } }) }]
    )
  }

  function openSetupSection(targetStep: TailorSetupStep) {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    setFocusedTextField(null)
    setStep(targetStep)
    setSetupView('section')
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false })
    })
  }

  function returnToSetupHub() {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    setFocusedTextField(null)
    setSetupToast(null)
    setSetupView('hub')
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false })
    })
  }

  async function next() {
    if (saving || uploadingId || uploadingMedia) return
    const shouldValidateIdentity = setupView === 'hub' || step === 0
    const nextNameError = shouldValidateIdentity ? (validateDisplayName(displayName) ?? '') : nameError
    const nextPhoneError =
      shouldValidateIdentity
        ? await validatePhoneAvailability(phone)
        : phoneError
    const nextBioError = shouldValidateIdentity ? getBioValidationError(bio) : bioError

    if (shouldValidateIdentity) {
      setNameError(nextNameError)
      setPhoneError(nextPhoneError)
      setBioError(nextBioError)
    }

    const progress = getSetupProgress({
      nameError: nextNameError,
      phoneError: nextPhoneError,
      bioError: nextBioError,
    })

    if (setupView === 'hub') {
      if (SETUP_STEP_IDS.every((stepId) => progress.stepValid[stepId]) && hasTrustVideoForSetup()) {
        setVisibleErrors({})
        void finish()
        return
      }
      openSetupSection(progress.firstIncompleteStep)
      return
    }

    if (!progress.stepValid[step]) {
      const currentErrors = progress.stepErrors[step]
      setVisibleErrors(currentErrors)
      if (currentErrors.idDocument) {
        setIdError(currentErrors.idDocument)
      }
      focusFirstSetupError(currentErrors, step)
      return
    }

    if (step === 0) {
      const phoneVerifiedForAdvance = await ensurePhoneVerifiedForSetup('advance')
      if (!phoneVerifiedForAdvance) return
    }

    setVisibleErrors({})
    if (step === 3 && !hasTrustVideoForSetup()) {
      setIdError(TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE)
      setVisibleErrors({ idDocument: TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE })
      focusFirstSetupError({ idDocument: TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE }, 3)
      return
    }
    setIdError('')
    if (step < 3) {
      showSetupToast(`${stepLabels[step]} section completed`, 'success')
      hapticSuccess()
      openSetupSection((step + 1) as TailorSetupStep)
      return
    }
    void finish()
  }

  function goBack() {
    if (setupView === 'section') {
      if (step > 0) {
        openSetupSection((step - 1) as TailorSetupStep)
        return
      }
      returnToSetupHub()
      return
    }
    Alert.alert(
      'Leave setup?',
      'Your tailor profile is not finished yet. You can stay here, return to customer mode, or sign out and come back later.',
      [
        { text: 'Stay', style: 'cancel' },
        { text: 'Return to customer', onPress: switchBackToCustomer },
        { text: 'Sign out', style: 'destructive', onPress: handleSignOut },
      ]
    )
  }

  const setupProgress = getSetupProgress({
    nameError: validateDisplayName(displayName) ?? '',
    phoneError: !phone.trim() ? TAILOR_SETUP_VALIDATION.PHONE_REQUIRED_MESSAGE : (validatePhoneForProfile(phone) ?? ''),
    bioError: getBioValidationError(bio),
  })
  const proofChecklistLabel =
    sellerType === 'BOUTIQUE'
      ? 'Ready-made listing'
      : sellerType === 'TAILOR_SHOP'
        ? 'Portfolio + ready-made item'
        : 'Portfolio sample'
  const proofChecklistDetail =
    sellerType === 'BOUTIQUE'
      ? 'Add one ready-made item customers can inspect.'
      : sellerType === 'TAILOR_SHOP'
        ? 'Add a work sample and a ready-made item customers can inspect.'
        : 'Add at least one real work sample customers can inspect.'
  const setupChecklist = [
    {
      label: 'Contact + public profile',
      detail: 'Verified phone, display name, photo, location, and bio.',
      complete: setupProgress.stepValid[0] && isCurrentPhoneVerified(phone) && !profileImageRejectionActive,
      targetStep: 0 as TailorSetupStep,
    },
    {
      label: 'Business type + pricing',
      detail: 'Choose Tailor, Boutique, or Tailor shop and set a visible price guide.',
      complete: setupProgress.stepValid[1],
      targetStep: 1 as TailorSetupStep,
    },
    {
      label: proofChecklistLabel,
      detail: proofChecklistDetail,
      complete: setupProgress.stepValid[2],
      targetStep: 2 as TailorSetupStep,
    },
    {
      label: 'Trust & handoff',
      detail: 'Record a private challenge video and add customer handoff details. Payout verification stays with your payout provider.',
      complete: setupProgress.stepValid[3],
      targetStep: 3 as TailorSetupStep,
    },
  ]
  const checklistRemaining = setupChecklist.filter((item) => !item.complete).length
  const setupReadyToSubmit = SETUP_STEP_IDS.every((stepId) => setupProgress.stepValid[stepId]) && hasTrustVideoForSetup()
  const selectedSellerType = SELLER_TYPE_OPTIONS.find((item) => item.value === sellerType) ?? SELLER_TYPE_OPTIONS[0]
  const proofStepTitle = sellerType === 'BOUTIQUE' ? 'Shop proof' : sellerType === 'TAILOR_SHOP' ? 'Public proof' : 'Portfolio'
  const proofStepBody = sellerType === 'BOUTIQUE'
    ? 'Add your first ready-made item so customers can inspect what your shop sells.'
    : sellerType === 'TAILOR_SHOP'
      ? 'Add portfolio media and one ready-made item so customers can inspect both sides of your shop.'
      : STEP_SUBS[2]
  const stepTitles = [STEP_TITLES[0], STEP_TITLES[1], proofStepTitle, STEP_TITLES[3]]
  const stepSubs = [STEP_SUBS[0], STEP_SUBS[1], proofStepBody, STEP_SUBS[3]]
  const stepLabels = [STEP_LABELS[0], STEP_LABELS[1], proofStepTitle, STEP_LABELS[3]]
  const hasPortfolioProof = portfolioItems.length >= MIN_PORTFOLIO_ITEMS
  const hasReadyMadeProof = readyMadeItemCount > 0
  const proofCountText = sellerType === 'BOUTIQUE'
    ? hasReadyMadeProof
      ? String(readyMadeItemCount) + ' ready-made item' + (readyMadeItemCount === 1 ? '' : 's') + ' added'
      : 'Add 1 ready-made item to continue'
    : sellerType === 'TAILOR_SHOP'
      ? hasPortfolioProof && hasReadyMadeProof
        ? String(portfolioItems.length) + '/' + String(MAX_PORTFOLIO_ITEMS) + ' portfolio media · ' + String(readyMadeItemCount) + ' ready-made item' + (readyMadeItemCount === 1 ? '' : 's')
        : !hasPortfolioProof && !hasReadyMadeProof
          ? 'Add portfolio media and 1 ready-made item to continue'
          : !hasPortfolioProof
            ? 'Add portfolio media to continue'
            : 'Add 1 ready-made item to continue'
      : hasPortfolioProof
        ? String(portfolioItems.length) + '/' + String(MAX_PORTFOLIO_ITEMS) + ' portfolio media added'
        : 'Add 1 work sample to continue'
  const proofVideoText = sellerType !== 'BOUTIQUE'
    ? ' · ' + String(portfolioItems.filter((i) => i.type === 'video').length) + '/' + String(MAX_PORTFOLIO_VIDEOS) + ' videos'
    : ''
  const fulfillmentSelections = [
    pickupAvailable ? 'Pickup' : null,
    deliveryAvailable ? 'Delivery' : null,
    shippingAvailable ? 'Shipping' : null,
  ].filter(Boolean) as string[]
  const fulfillmentLabel = fulfillmentSelections.length > 0 ? fulfillmentSelections.join(', ') : 'Not selected'
  const fulfillmentHint =
    fulfillmentSelections.length > 0
      ? 'These options appear during checkout for eligible orders.'
      : 'Choose at least one way customers receive orders.'
  const stepBlockingNote =
    step === 1 && (!priceMin || !priceMax)
      ? 'Set a price range to continue'
      : step === 2 && setupProgress.fieldErrors.portfolio
        ? setupProgress.fieldErrors.portfolio
        : step === 3 && !(supportsCustomOrders || supportsReadyMade)
          ? 'Choose at least one way customers can order from you'
          : step === 3 && !(pickupAvailable || deliveryAvailable || shippingAvailable)
            ? 'Choose at least one way customers receive orders'
            : step === 3 && !hasTrustVideoForSetup()
              ? TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE
            : ''
  const primaryCtaLabel = uploadingMedia
    ? 'Uploading…'
    : setupView === 'hub'
      ? saving || uploadingId
        ? 'Submitting…'
        : setupReadyToSubmit
          ? 'Submit for review'
          : 'Resume setup'
      : saving || uploadingId
        ? 'Submitting…'
        : step === 3
          ? 'Submit for review'
          : 'Save and continue'
  const currentSetupSectionBlocked =
    setupView === 'section' &&
    (!setupProgress.stepValid[step] || (step === 3 && !hasTrustVideoForSetup()))
  const editingLayoutActive = keyboard.visible || focusedTextField !== null
  const scrollBottomPadding =
    DRAPE_FLOATING_ACTION_DOCK_CLEARANCE +
    (setupView === 'hub' && !editingLayoutActive ? 112 : 40)
  const portfolioGridEntries = useMemo(
    () => previewPortfolioGridEntries(portfolioItems, portfolioDragIndex, portfolioHoverIndex),
    [portfolioDragIndex, portfolioHoverIndex, portfolioItems]
  )
  const selectedPortfolioItem =
    selectedPortfolioIndex != null &&
    selectedPortfolioIndex >= 0 &&
    selectedPortfolioIndex < portfolioItems.length
      ? portfolioItems[selectedPortfolioIndex]
      : null
  const portfolioVideoLimitReached =
    portfolioItems.filter((i) => i.type === 'video').length -
      (portfolioReplaceIndex != null && portfolioItems[portfolioReplaceIndex]?.type === 'video' ? 1 : 0) >=
    MAX_PORTFOLIO_VIDEOS

  const animateEditingLayout = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
  }, [])

  const focusTextField = useCallback((field: string) => {
    animateEditingLayout()
    setFocusedTextField(field)
  }, [animateEditingLayout])

  const blurTextField = useCallback((field: string) => {
    animateEditingLayout()
    setFocusedTextField((current) => (current === field ? null : current))
  }, [animateEditingLayout])

  const scrollFocusedBioIntoView = useCallback(() => {
    setTimeout(() => {
      scrollRef.current?.scrollTo({
        y: Math.max(0, bioFieldYRef.current - FOCUSED_FIELD_TOP_OFFSET),
        animated: true,
      })
    }, FOCUSED_FIELD_SCROLL_DELAY_MS)
  }, [])

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header */}
        <View style={styles.header}>
          <AuthBackButton onPress={goBack} />
          <Text style={styles.stepCount}>{setupView === 'hub' ? 'Setup' : `${step + 1} / 4`}</Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* Progress stepper with step labels */}
        {setupView === 'section' ? <ProgressStepper steps={stepLabels} current={step} /> : null}

        {setupToast ? (
          <View
            style={[
              styles.setupToast,
              setupToast.type === 'error' ? styles.setupToastError : styles.setupToastSuccess,
            ]}
          >
            <Text
              style={[
                styles.setupToastText,
                setupToast.type === 'error' ? styles.setupToastTextError : styles.setupToastTextSuccess,
              ]}
            >
              {setupToast.message}
            </Text>
          </View>
        ) : null}

        <KeyboardAwareScrollView
          ref={scrollRef}
          style={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          scrollEnabled={portfolioDragIndex === null}
          onScroll={actionDockScroll.onScroll}
          scrollEventThrottle={actionDockScroll.scrollEventThrottle}
          contentContainerStyle={{ paddingBottom: scrollBottomPadding }}
        >
          <View style={styles.content}>
            {setupView === 'hub' ? (
              <>
                <AuthEntryHeader
                  eyebrow="Tailor profile"
                  title="Finish tailor profile"
                  body="Complete the profile pieces Drapeon needs before review."
                  showWordmark={false}
                />

                {idVerificationStatus === 'REJECTED' ? (
                  <View style={styles.identityRejectedCard}>
                    <Text style={styles.identityRejectedTitle}>
                      {profileImageRejectionActive
                        ? 'Profile photo needs replacement'
                        : portfolioRejectionActive
                          ? 'Portfolio needs an update'
                          : 'Private video retake needed'}
                    </Text>
                    <Text style={styles.identityRejectedText}>{idRejectionReason || readIdentityRejectionMessage({})}</Text>
                    {portfolioRejectionActive ? (
                      <TouchableOpacity style={styles.identityRejectedAction} onPress={() => openSetupSection(2)}>
                        <Text style={styles.identityRejectedActionText}>Update portfolio</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : null}

                <View style={styles.setupChecklistCard}>
                  <View style={styles.setupChecklistHeader}>
                    <Text style={styles.setupChecklistTitle}>Go-live checklist</Text>
                    <Text style={styles.setupChecklistMeta}>
                      {checklistRemaining === 0 ? 'Ready to submit' : `${checklistRemaining} needed`}
                    </Text>
                  </View>
                  {setupChecklist.map((item) => {
                    const isCurrentStep = item.targetStep === setupProgress.firstIncompleteStep
                    const isActionable = !setupReadyToSubmit && isCurrentStep
                    const stateLabel = item.complete ? 'Done' : isActionable ? 'Next' : 'Locked'
                    return (
                      <TouchableOpacity
                        key={item.label}
                        style={[
                          styles.setupChecklistRow,
                          isActionable && styles.setupChecklistRowActive,
                          !item.complete && !isActionable && styles.setupChecklistRowDeferred,
                        ]}
                        onPress={() => {
                          if (isActionable) openSetupSection(item.targetStep)
                        }}
                        disabled={!isActionable}
                        activeOpacity={0.85}
                      >
                        <View
                          style={[
                            styles.setupChecklistMark,
                            item.complete && styles.setupChecklistMarkDone,
                            !item.complete && !isActionable && styles.setupChecklistMarkDeferred,
                          ]}
                        >
                          <Text
                            style={[
                              styles.setupChecklistMarkText,
                              item.complete && styles.setupChecklistMarkTextDone,
                            ]}
                          >
                            {item.complete ? '✓' : isActionable ? '!' : '•'}
                          </Text>
                        </View>
                        <View style={styles.setupChecklistTextBlock}>
                          <Text style={styles.setupChecklistLabel}>{item.label}</Text>
                          <Text style={styles.setupChecklistDetail}>{item.detail}</Text>
                        </View>
                        <Text
                          style={[
                            styles.setupChecklistState,
                            item.complete && styles.setupChecklistStateDone,
                            !item.complete && !isActionable && styles.setupChecklistStateDeferred,
                          ]}
                        >
                          {stateLabel}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                  <View style={styles.setupChecklistFooter}>
                    <Text style={styles.setupChecklistFooterText}>
                      Drapeon reviews your public profile, proof, and identity before account access expands. Paid work opens after payout setup is verified.
                    </Text>
                  </View>
                </View>
              </>
            ) : !editingLayoutActive ? (
              <AuthEntryHeader
                eyebrow="Tailor profile"
                title={stepTitles[step]}
                body={stepSubs[step]}
                showWordmark={false}
              />
            ) : null}

            {/* ── Step 0: Identity ── */}
            {setupView === 'section' && step === 0 && (
              <View style={styles.formCard}>
                <View style={styles.fields}>
                  {!editingLayoutActive ? (
                    <View onLayout={rememberSetupFieldY('profilePhoto')}>
                      <TouchableOpacity
                        style={[
                          styles.profilePhotoPicker,
                          !!visibleErrors.profilePhoto && styles.profilePhotoPickerError,
                          profileImageRejectionActive && styles.profilePhotoPickerRejected,
                        ]}
                        onPress={openProfilePhotoPicker}
                        disabled={uploadingAvatar}
                        activeOpacity={0.86}
                        accessibilityRole="button"
                        accessibilityLabel={avatarUrl ? 'Change profile photo' : 'Add profile photo'}
                        accessibilityState={{ disabled: uploadingAvatar, busy: uploadingAvatar }}
                      >
                        <View style={[styles.profilePhotoPreview, profileImageRejectionActive && styles.profilePhotoPreviewRejected]}>
                          {uploadingAvatar ? (
                            <ActivityIndicator color={Colors.needleGreen} />
                          ) : avatarUrl ? (
                            <AvatarImage
                              uri={avatarUrl}
                              initials={displayName || user?.email}
                              size={68}
                              borderWidth={0}
                            />
                          ) : (
                            <Text style={styles.profilePhotoInitial}>
                              {(displayName.trim()[0] || 'D').toUpperCase()}
                            </Text>
                          )}
                          {profileImageRejectionActive ? (
                            <Text style={styles.profilePhotoRejectedBadge}>Invalid</Text>
                          ) : null}
                        </View>
                        <View style={styles.profilePhotoCopy}>
                          <Text style={styles.profilePhotoTitle}>Profile photo</Text>
                          <Text style={[styles.profilePhotoHint, profileImageRejectionActive && styles.profilePhotoHintRejected]}>
                            {profileImageRejectionActive
                              ? PROFILE_IMAGE_REJECTION_MESSAGE
                              : 'Take or choose a clear face photo. Customers see this before booking.'}
                          </Text>
                        </View>
                        <Text style={styles.profilePhotoAction}>{profileImageRejectionActive ? 'Replace' : avatarUrl ? 'Change' : 'Add'}</Text>
                      </TouchableOpacity>
                      {!!visibleErrors.profilePhoto && (
                        <Text style={styles.helperError} accessibilityRole="alert">{visibleErrors.profilePhoto}</Text>
                      )}
                    </View>
                  ) : null}
                  <View onLayout={rememberSetupFieldY('displayName')}>
                    <Input
                      label="Display name"
                      placeholder="e.g. John Doe"
                      value={displayName}
                      onChangeText={(value) => {
                        setDisplayName(value)
                        clearVisibleError('displayName')
                        if (nameError) validateName(value)
                      }}
                      onFocus={() => focusTextField('displayName')}
                      onBlur={() => {
                        blurTextField('displayName')
                        validateName(displayName)
                      }}
                      error={nameError || visibleErrors.displayName}
                      required
                      autoCapitalize="words"
                      textContentType="name"
                      autoComplete="name"
                      hint="No @, URLs, or phone numbers. This is your public name."
                      testID="display-name-input"
                    />
                  </View>
                  <View onLayout={rememberSetupFieldY('phone')}>
                    <PhoneNumberInput
                      label="Phone number"
                      placeholder="For order updates and account recovery"
                      value={phone}
                      onChangeText={(value) => {
                        latestPhoneRef.current = value
                        setPhone(value)
                        if (phoneValidationMessage(value)) setPhoneAvailabilityChecking(false)
                        clearVisibleError('phone')
                        if (phoneError) validatePhone(value)
                      }}
                      onFocus={() => focusTextField('phone')}
                      onBlur={() => {
                        blurTextField('phone')
                        void validatePhoneAvailability(phone)
                      }}
                      error={phoneError || visibleErrors.phone}
                      required
                      hint={phoneAvailabilityChecking ? 'Checking phone number…' : `${PHONE_STORAGE_HINT} ${ACCOUNT_PHONE_UNIQUENESS_HINT}`}
                      testID="phone-input"
                    />
                  </View>
                  <View onLayout={rememberSetupFieldY('location')}>
                    <Input
                      label="Location"
                      placeholder="e.g. Lagos, Nigeria"
                      value={location}
                      onChangeText={onLocationChange}
                      onFocus={() => focusTextField('location')}
                      onBlur={() => {
                        blurTextField('location')
                        setShowSuggestions(false)
                      }}
                      error={visibleErrors.location}
                      required
                      testID="location-input"
                      autoCorrect={false}
                      autoComplete="off"
                    />
                    {showSuggestions && locationSuggestions.length > 0 && (
                      <View style={styles.suggestionsBox}>
                        {locationSuggestions.map((s, i) => (
                          <TouchableOpacity
                            key={i}
                            style={[
                              styles.suggestionRow,
                              i === locationSuggestions.length - 1 && styles.suggestionRowLast,
                            ]}
                            onPress={() => selectLocation(s)}
                            accessibilityRole="button"
                            accessibilityLabel={`Use location ${s}`}
                          >
                            <Text style={styles.suggestionText}>{s}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                  <View
                    onLayout={(event) => {
                      bioFieldYRef.current = event.nativeEvent.layout.y
                      setupFieldYRef.current.bio = event.nativeEvent.layout.y
                    }}
                  >
                    <Input
                      label="About you"
                      placeholder="Tell people who you are, what you make, and your experience. Min 80 characters."
                      value={bio}
                      onChangeText={(v) => {
                        setBio(v)
                        clearVisibleError('bio')
                        validateBio(v)
                      }}
                      onFocus={() => {
                        focusTextField('bio')
                        scrollFocusedBioIntoView()
                      }}
                      onBlur={() => {
                        blurTextField('bio')
                        validateBio(bio)
                      }}
                      error={bioError || visibleErrors.bio}
                      required
                      multiline
                      numberOfLines={5}
                      maxLength={500}
                      filterContact
                      hint={`Min 80 characters · ${bio.trim().length}/500. No social handles, phone numbers, or URLs.`}
                      testID="bio-input"
                    />
                  </View>
                  <Text style={styles.fieldHint}>What customers look for</Text>
                  <View style={styles.helperList}>
                    {BIO_PROMPTS.map((prompt) => (
                      <View key={prompt} style={styles.helperListRow}>
                        <View style={styles.helperBullet} />
                        <Text style={styles.helperListText}>{prompt}</Text>
                      </View>
                    ))}
                  </View>

                  <View onLayout={rememberSetupFieldY('languages')}>
                    <TagSelector
                      label="Languages you speak"
                      options={LANGUAGE_GROUPS}
                      selected={languages}
                      maxSelected={MAX_LANGUAGE_TAGS}
                      maxSelectedMessage={TAILOR_SETUP_VALIDATION.LANGUAGE_LIMIT_MESSAGE}
                      onChange={(nextLanguages) => {
                        setLanguages(nextLanguages.slice(0, MAX_LANGUAGE_TAGS))
                        clearVisibleError('languages')
                      }}
                      searchable
                      searchOnly
                    />
                    {!!visibleErrors.languages && (
                      <Text style={styles.helperError} accessibilityRole="alert">{visibleErrors.languages}</Text>
                    )}
                  </View>
                </View>
              </View>
            )}

            {/* ── Step 1: Specialties + pricing ── */}
            {setupView === 'section' && step === 1 && (
              <View style={styles.formCard}>
                <View style={styles.fields}>
                  <View onLayout={rememberSetupFieldY('specialties')}>
                    <TagSelector
                      label="What do you make?"
                      required
                      hint="Select all that apply. These appear on your public profile."
                      options={SPECIALTY_GROUPS}
                      selected={specialties}
                      maxSelected={MAX_SPECIALTY_TAGS}
                      maxSelectedMessage={TAILOR_SETUP_VALIDATION.SPECIALTY_LIMIT_MESSAGE}
                      onChange={(nextSpecialties) => {
                        setSpecialties(nextSpecialties.slice(0, MAX_SPECIALTY_TAGS))
                        clearVisibleError('specialties')
                      }}
                      searchable
                    />
                    {!!visibleErrors.specialties && (
                      <Text style={styles.helperError} accessibilityRole="alert">{visibleErrors.specialties}</Text>
                    )}
                  </View>

                  <View>
                    <Text style={styles.fieldLabel}>Business type</Text>
                    <SetupSelectorCard
                      title={selectedSellerType.label}
                      body={selectedSellerType.hint}
                      meta="Business type"
                      onPress={() => setChoiceSheetMode('seller-type')}
                    />
                  </View>

                  <View onLayout={rememberSetupFieldY('priceRange')}>
                    <Text style={styles.fieldLabel}>
                      Typical price range <Text style={styles.required}>*</Text>
                    </Text>
                    <Text style={styles.fieldHint}>
                      This shows on your profile as a guide, not a fixed price. For {currency}, use
                      at least {priceMinGuide} and keep the high end at {priceMaxGuide} or less.
                    </Text>
                    <Text style={styles.fieldHint}>
                      {currencySource === 'UNSUPPORTED_FALLBACK'
                        ? 'Currency starts from your region when available. USD is the fallback for regions we do not support yet.'
                        : 'Currency starts from your region when available. You can change it before saving.'}
                    </Text>
                    <SetupSelectorCard
                      title={currency}
                      body="This is the currency customers see for your profile price guide."
                      meta="Pricing currency"
                      onPress={() => setChoiceSheetMode('currency')}
                    />
                    <View style={[styles.infoBox, styles.currencyProviderNote]}>
                      <Text style={styles.infoText}>
                        Customers see this currency. Payout setup follows it later, so choose one you can accept payouts in.
                      </Text>
                    </View>
                    {currency === 'NGN' ? (
                      <View style={styles.quickRangeList}>
                        {PRICE_PRESETS.map((preset) => (
                          <TouchableOpacity
                            key={preset.label}
                            style={styles.quickRangeRow}
                            onPress={() => {
                              setCurrency(preset.currency)
                              setPriceMin(preset.min)
                              setPriceMax(preset.max)
                              clearVisibleError('priceRange')
                            }}
                            activeOpacity={0.78}
                          >
                            <View>
                              <Text style={styles.quickRangeTitle}>{preset.label}</Text>
                              <Text style={styles.quickRangeBody}>
                                {preset.currency} {preset.min}–{preset.max}
                              </Text>
                            </View>
                            <Feather name="plus" size={17} color={Colors.needleGreen} />
                          </TouchableOpacity>
                        ))}
                      </View>
                    ) : null}
                    <View style={styles.priceRow}>
                      <MoneyInput
                        label="From"
                        placeholder="50"
                        value={priceMin}
                        onChangeText={(value) => {
                          setPriceMin(value)
                          clearVisibleError('priceRange')
                        }}
                        onFocus={() => focusTextField('priceMin')}
                        onBlur={() => blurTextField('priceMin')}
                        currency={currency as AccountCurrencyCode}
                        required
                        containerStyle={styles.priceInput}
                      />
                      <MoneyInput
                        label="To"
                        placeholder="500"
                        value={priceMax}
                        onChangeText={(value) => {
                          setPriceMax(value)
                          clearVisibleError('priceRange')
                        }}
                        onFocus={() => focusTextField('priceMax')}
                        onBlur={() => blurTextField('priceMax')}
                        currency={currency as AccountCurrencyCode}
                        required
                        containerStyle={styles.priceInput}
                      />
                    </View>
                    {!!priceMin &&
                      !!priceMax &&
                      parseTailorPriceMajor(priceMax) < parseTailorPriceMajor(priceMin) && (
                        <Text style={styles.priceError} accessibilityRole="alert">"To" must be greater than "From"</Text>
                      )}
                    {!!visibleErrors.priceRange && (
                      <Text style={styles.helperError} accessibilityRole="alert">{visibleErrors.priceRange}</Text>
                    )}
                  </View>
                </View>
              </View>
            )}

            {/* ── Step 2: Portfolio ── */}
            {setupView === 'section' && step === 2 && (
              <View style={styles.formCard}>
                <View style={styles.fields}>
                  <View style={styles.portfolioStatus} onLayout={rememberSetupFieldY('portfolio')}>
                    <View style={styles.portfolioBar}>
                      <View
                        style={[
                          styles.portfolioBarFill,
                          { width: `${(portfolioItems.length / MAX_PORTFOLIO_ITEMS) * 100}%` },
                        ]}
                      />
                      <View style={styles.portfolioBarMinMarker} />
                    </View>
                    <Text style={styles.portfolioCount}>
                      {proofCountText}{proofVideoText}
                    </Text>
                    {!!visibleErrors.portfolio && (
                      <Text style={styles.helperError} accessibilityRole="alert">{visibleErrors.portfolio}</Text>
                    )}
                    {portfolioMediaStatus ? (
                      <View style={styles.portfolioMediaStatus}>
                        <ActivityIndicator size="small" color={Colors.needleGreen} />
                        <Text style={styles.portfolioMediaStatusText}>{portfolioMediaStatus}</Text>
                      </View>
                    ) : null}
                  </View>

                  {sellerType === 'BOUTIQUE' || sellerType === 'TAILOR_SHOP' ? (
                    <View style={styles.infoBox}>
                      <Text style={styles.infoText}>
                        {readyMadeItemCount > 0
                          ? 'Ready-made item added: ' + String(readyMadeItemCount) + ' item' + (readyMadeItemCount === 1 ? '' : 's') + ' in your shop.'
                          : sellerType === 'TAILOR_SHOP'
                            ? 'Add one ready-made item so customers can inspect your shop side too.'
                            : 'Add one ready-made item customers can inspect before review.'}
                      </Text>
                      <TouchableOpacity
                        style={styles.inlineActionButton}
                        onPress={() => { void openReadyMadeItemCreator() }}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        accessibilityLabel="Create ready-made item"
                      >
                        <Text style={styles.inlineActionText}>Create ready-made item</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}

                  {sellerType !== 'BOUTIQUE' ? (
                  <View style={styles.portfolioGrid}>
                    {portfolioGridEntries.map(({ item, originalIndex }, visualIndex) => (
                      <PortfolioSortableTile
                        key={`${item.type}-${item.url}-${originalIndex}`}
                        item={item}
                        index={visualIndex}
                        isCover={visualIndex === 0}
                        dragging={portfolioDragIndex === originalIndex}
                        onOpen={() => setSelectedPortfolioIndex(originalIndex)}
                        onDelete={() => removePortfolioItem(originalIndex)}
                        onDragStart={() => {
                          setPortfolioDragIndex(originalIndex)
                          setPortfolioHoverIndex(originalIndex)
                        }}
                        onDragMove={(dx, dy) => handlePortfolioDragMove(originalIndex, dx, dy)}
                        onDragEnd={(dx, dy) => handlePortfolioDragEnd(originalIndex, dx, dy)}
                      />
                    ))}
                    {uploadingMedia ? (
                      <View style={[styles.portfolioAdd, styles.portfolioPending]}>
                        <ActivityIndicator size="small" color={Colors.needleGreen} />
                        <Text style={styles.portfolioAddLabel}>Adding</Text>
                      </View>
                    ) : null}
                    {portfolioItems.length < MAX_PORTFOLIO_ITEMS && (
                      <TouchableOpacity
                        style={styles.portfolioAdd}
                        onPress={openPortfolioMediaPicker}
                        disabled={uploadingMedia}
                      >
                        <Text style={styles.portfolioAddIcon}>+</Text>
                        <Text style={styles.portfolioAddLabel}>Add media</Text>
                        <Text style={styles.portfolioAddHint}>Multi-select from library</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  ) : null}
                </View>
              </View>
            )}

            {selectedPortfolioItem ? (
              <PortfolioMediaManagerModal
                items={portfolioItems}
                index={selectedPortfolioIndex ?? 0}
                onIndexChange={setSelectedPortfolioIndex}
                onClose={() => setSelectedPortfolioIndex(null)}
                onReplace={() => {
                  if (selectedPortfolioIndex != null) {
                    const replaceIndex = selectedPortfolioIndex
                    setSelectedPortfolioIndex(null)
                    openPortfolioReplacePicker(replaceIndex)
                  }
                }}
                onDelete={() => {
                  if (selectedPortfolioIndex != null) removePortfolioItem(selectedPortfolioIndex)
                }}
              />
            ) : null}

            {/* ── Step 3: Selling setup + ID verification ── */}
            {setupView === 'section' && step === 3 && (
              <View style={styles.formCard}>
                <View style={styles.fields}>
                  {supportsCustomOrders ? (
                    <View>
                      <Text style={styles.fieldLabel}>Custom order status</Text>
                      <SetupSelectorCard
                        title={acceptsCustomOrdersNow ? 'Taking custom orders' : 'Custom orders paused'}
                        body={acceptsCustomOrdersNow
                          ? 'Customers can send custom briefs for quotes.'
                          : 'Your profile stays visible, but custom brief requests are paused.'}
                        meta="Custom orders"
                        onPress={() => setChoiceSheetMode('capacity')}
                      />
                    </View>
                  ) : null}

                  {supportsReadyMade ? (
                    <View>
                      <Text style={styles.fieldLabel}>Ready-made shop status</Text>
                      <SetupSelectorCard
                        title={shopPaused ? 'Shop checkout paused' : 'Shop checkout open'}
                        body={shopPaused
                          ? 'Customers can browse your items, but checkout is paused.'
                          : 'Customers can buy ready-made items when inventory is live.'}
                        meta="Shop status"
                        onPress={() => setChoiceSheetMode('shop-status')}
                      />
                    </View>
                  ) : null}

                  <View onLayout={rememberSetupFieldY('fulfillment')}>
                    <Text style={styles.fieldLabel}>How customers receive orders</Text>
                    <SetupSelectorCard
                      title={fulfillmentLabel}
                      body={fulfillmentHint}
                      meta="Customer handoff"
                      warning={!!visibleErrors.fulfillment || fulfillmentSelections.length === 0}
                      onPress={() => setChoiceSheetMode('fulfillment')}
                    />
                    {!!visibleErrors.fulfillment && (
                      <Text style={styles.helperError} accessibilityRole="alert">{visibleErrors.fulfillment}</Text>
                    )}
                    {pickupAvailable || deliveryAvailable || shippingAvailable ? (
                      <View style={styles.fulfillmentFeeBlock} onLayout={rememberSetupFieldY('pickupAddress')}>
                        <Text style={styles.fieldLabel}>{pickupAvailable ? 'Fulfillment origin and pickup details' : 'Fulfillment origin details'}</Text>
                        <Text style={styles.fieldHint}>
                          Double-check this exact address before you save. It is used to verify
                          delivery and shipping eligibility, and customers only see it when needed.
                        </Text>
                        <AddressAutocompleteInput
                          label={pickupAvailable ? 'Pickup address' : 'Fulfillment origin address'}
                          placeholder="e.g. 12 Marina Road, Victoria Island"
                          value={pickupAddress}
                          onChangeText={(value) => {
                            setPickupAddress(value)
                            clearVisibleError('pickupAddress')
                          }}
                          onSelectAddress={(address) => {
                            setPickupAddress(address.line1 || address.displayValue)
                            setPickupCity(address.city)
                            setPickupRegion(address.stateRegion)
                            setPickupPostalCode(address.postcode)
                            if (address.countryCode) setPickupCountryCode(address.countryCode)
                            clearVisibleError('pickupAddress')
                          }}
                          onFocus={() => focusTextField('pickupAddress')}
                          onBlur={() => blurTextField('pickupAddress')}
                          hint="Search and tap a suggestion to autofill, or type the full address manually. Include street or building, district or city, state or region, postal code if used, and country."
                          multiline
                        />
                        <Input
                          label={pickupAvailable ? 'Pickup city' : 'Fulfillment origin city'}
                          placeholder="City"
                          value={pickupCity}
                          onChangeText={setPickupCity}
                          textContentType="addressCity"
                          autoComplete="postal-address-locality"
                        />
                        <Input
                          label="State / region"
                          placeholder="State or region"
                          value={pickupRegion}
                          onChangeText={setPickupRegion}
                          textContentType="addressState"
                          autoComplete="postal-address-region"
                        />
                        <Input
                          label="Postcode / ZIP (optional)"
                          placeholder="Postcode / ZIP"
                          value={pickupPostalCode}
                          onChangeText={setPickupPostalCode}
                          textContentType="postalCode"
                          autoComplete="postal-code"
                        />
                        <Input
                          label={pickupAvailable ? 'Pickup country code' : 'Fulfillment origin country code'}
                          placeholder="e.g. GH"
                          value={pickupCountryCode}
                          onChangeText={(value) => setPickupCountryCode(value.toUpperCase().slice(0, 2))}
                          hint="Use the 2-letter country code."
                        />
                        <Input
                          label="Pickup instructions (optional)"
                          placeholder="e.g. Ask for the front desk and bring your collection code."
                          value={pickupInstructions}
                          onChangeText={setPickupInstructions}
                          onFocus={() => focusTextField('pickupInstructions')}
                          onBlur={() => blurTextField('pickupInstructions')}
                        />
                        {pickupAddress.trim().length === 0 ? (
                          <Text style={styles.helperError} accessibilityRole="alert">
                            Add your exact fulfillment origin address to keep pickup, delivery, or shipping turned on.
                          </Text>
                        ) : pickupAddress.trim().length < 8 ? (
                          <Text style={styles.helperError} accessibilityRole="alert">
                            Add a fuller origin address before offering delivery or shipping.
                          </Text>
                        ) : visibleErrors.pickupAddress ? (
                          <Text style={styles.helperError} accessibilityRole="alert">{visibleErrors.pickupAddress}</Text>
                        ) : null}
                      </View>
                    ) : null}
                    {deliveryAvailable || shippingAvailable ? (
                      <View style={styles.fulfillmentFeeBlock}>
                        <Text style={styles.fieldLabel}>Drapeon-coordinated dispatch</Text>
                        <Text style={styles.fieldHint}>
                          Drapeon coordinates delivery and shipping with you when an order needs it.
                          Choose the handoff options you can support.
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  <View onLayout={rememberSetupFieldY('idDocument')}>
                    <Text style={styles.fieldLabel}>Marketplace trust video</Text>
                    <Text style={styles.fieldHint}>
                      Record the private challenge below so Drapeon can confirm a real person stands behind this profile and its work. No government ID is collected. Your payout provider verifies payouts separately.
                    </Text>
                    {trustChallengeText ? (
                      <View style={styles.identityRejectedCardCompact}>
                        <Text style={styles.identityRejectedTitle}>Your private challenge</Text>
                        <Text style={styles.identityRejectedText}>{trustChallengeText}</Text>
                      </View>
                    ) : null}
                    {idVerificationStatus === 'REJECTED' ? (
                      <View style={styles.identityRejectedCardCompact}>
                        <Text style={styles.identityRejectedTitle}>
                          {profileImageRejectionActive
                            ? 'Profile photo needs replacement'
                            : portfolioRejectionActive
                              ? 'Portfolio update needed'
                              : 'Retake guidance'}
                        </Text>
                        <Text style={styles.identityRejectedText}>{idRejectionReason || readIdentityRejectionMessage({})}</Text>
                      </View>
                    ) : null}
                    {trustVideoUri ? (
                      <View style={styles.idPreviewWrap}>
                        <PortfolioVideoPreview
                          uri={trustVideoUri}
                          style={styles.idPreview}
                          contentFit="cover"
                          nativeControls
                          autoplay={false}
                        />
                        <TouchableOpacity
                          onPress={() => {
                            setTrustVideoUri(null)
                            setIdError(TAILOR_SETUP_VALIDATION.ID_DOCUMENT_REQUIRED_MESSAGE)
                          }}
                        >
                          <Text style={styles.idRemove}>Replace recording (optional)</Text>
                        </TouchableOpacity>
                      </View>
                    ) : hasTrustVideoForSetup() ? (
                      <View style={styles.idExistingRow}>
                        <View style={styles.idExistingIcon}>
                          <Feather name="video" size={14} color={Colors.needleGreen} />
                        </View>
                        <View style={styles.idExistingCopy}>
                          <Text style={styles.idExistingTitle}>Trust video submitted</Text>
                          <Text style={styles.idExistingHint}>Trust review is already in progress or complete for this profile.</Text>
                        </View>
                        <TouchableOpacity onPress={() => { void openTrustVideoPicker() }} hitSlop={8}>
                          <Text style={styles.idExistingAction}>Record a replacement (optional)</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={[styles.idPickBtn, !!idError && styles.idPickBtnError]}
                        onPress={() => { void openTrustVideoPicker() }}
                        disabled={trustChallengeLoading}
                        accessibilityRole="button"
                        accessibilityLabel="Record private trust video"
                      >
                        <View style={styles.idPickIconWrap}>
                          {trustChallengeLoading ? (
                            <ActivityIndicator size="small" color={Colors.needleGreen} />
                          ) : (
                            <Feather name="video" size={22} color={Colors.needleGreen} />
                          )}
                        </View>
                        <Text style={styles.idPickLabel}>
                          {trustChallengeLoading ? 'Loading private challenge…' : 'Record trust video'}
                        </Text>
                        <Text style={styles.idPickHint}>
                          {TAILOR_TRUST_VIDEO_MIN_SECONDS}–{TAILOR_TRUST_VIDEO_MAX_SECONDS} seconds · face, voice, and private phrase
                        </Text>
                      </TouchableOpacity>
                    )}
                    {!!(idError || visibleErrors.idDocument) && (
                      <Text style={styles.helperError} accessibilityRole="alert">{idError || visibleErrors.idDocument}</Text>
                    )}
                    <TouchableOpacity
                      style={styles.identityConsentRow}
                      onPress={() => {
                        setIdentityConsentGranted((current) => !current)
                        setIdentityConsentError('')
                      }}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: identityConsentGranted }}
                      accessibilityLabel="Consent to trust verification video processing"
                    >
                      <View style={[
                        styles.identityConsentBox,
                        identityConsentGranted && styles.identityConsentBoxChecked,
                      ]}>
                        {identityConsentGranted ? (
                          <Feather name="check" size={15} color={Colors.white} />
                        ) : null}
                      </View>
                      <Text style={styles.identityConsentCopy}>{IDENTITY_CONSENT_COPY}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => { void Linking.openURL('https://drapeon.co/privacy') }}
                      accessibilityRole="link"
                      accessibilityLabel="Read Drapeon privacy policy"
                    >
                      <Text style={styles.identityPrivacyLink}>Read the Privacy Policy</Text>
                    </TouchableOpacity>
                    {identityConsentError ? (
                      <Text style={styles.helperError} accessibilityRole="alert">{identityConsentError}</Text>
                    ) : null}
                  </View>
                </View>
              </View>
            )}

            {setupView === 'hub' && !editingLayoutActive ? (
              <View style={styles.setupFooterLinks}>
                <TouchableOpacity
                  onPress={switchBackToCustomer}
                  style={styles.modeSwitchLink}
                  disabled={saving || uploadingId || uploadingMedia || switchingToCustomer}
                  accessibilityRole="button"
                  accessibilityLabel="Use Drapeon as a customer instead"
                  accessibilityState={{ disabled: saving || uploadingId || uploadingMedia || switchingToCustomer, busy: switchingToCustomer }}
                >
                  {switchingToCustomer ? (
                    <ActivityIndicator size="small" color={Colors.needleGreen} />
                  ) : (
                    <Text style={styles.modeSwitchText}>Use Drapeon as customer instead</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSignOut}
                  style={styles.signOutLink}
                  disabled={saving || uploadingId || uploadingMedia || switchingToCustomer}
                  accessibilityRole="button"
                  accessibilityLabel="Sign out or switch account"
                  accessibilityState={{ disabled: saving || uploadingId || uploadingMedia || switchingToCustomer }}
                >
                  <Text style={styles.signOutText}>Sign out</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => router.push('/(tailor)/profile/delete-account')}
                  style={styles.signOutLink}
                  disabled={saving || uploadingId || uploadingMedia || switchingToCustomer}
                  accessibilityRole="button"
                  accessibilityLabel="Delete this account"
                >
                  <Text style={styles.deleteAccountText}>Delete this account</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            {setupView === 'section' && stepBlockingNote ? (
              <Text style={styles.minNote} accessibilityLiveRegion="polite">{stepBlockingNote}</Text>
            ) : null}
          </View>
        </KeyboardAwareScrollView>

        <DrapeFloatingActionDock compactWidth={76} forceCompact={editingLayoutActive} testID="tailor-setup-action-dock">
          {actionDockCompact ? (
            <DrapeIconButton
              icon={step === 3 || setupView === 'hub' ? 'check' : 'arrow-right'}
              accessibilityLabel={primaryCtaLabel}
              tone="primary"
              onPress={() => { void next() }}
              disabled={saving || uploadingId || uploadingMedia || phoneAvailabilityChecking || phoneOtpSending || phoneOtpVerifying || currentSetupSectionBlocked}
            />
          ) : (
            <DrapeCapsuleButton
              label={primaryCtaLabel}
              icon={step === 3 || setupView === 'hub' ? 'check' : 'arrow-right'}
              style={styles.primaryDockButton}
              onPress={() => { void next() }}
              loading={saving || uploadingId || uploadingMedia || phoneAvailabilityChecking || phoneOtpSending || phoneOtpVerifying}
              disabled={saving || uploadingId || uploadingMedia || phoneAvailabilityChecking || phoneOtpSending || phoneOtpVerifying || currentSetupSectionBlocked}
            />
          )}
        </DrapeFloatingActionDock>
        <MediaChoiceSheet
          mode={mediaSheetMode}
          trustChallengeText={trustChallengeText}
          onClose={() => {
            setMediaSheetMode(null)
            setPortfolioReplaceIndex(null)
          }}
          onProfilePhoto={(source) => {
            setMediaSheetMode(null)
            void pickProfilePhoto(source)
          }}
          onPortfolioMedia={(source) => {
            setMediaSheetMode(null)
            void pickPortfolioMedia(source)
          }}
          onTrustVideo={(source) => {
            setMediaSheetMode(null)
            void pickTrustVideo(source)
          }}
          videoLimitReached={portfolioVideoLimitReached}
        />
        <SetupChoiceSheet
          mode={choiceSheetMode}
          onClose={() => setChoiceSheetMode(null)}
          sellerType={sellerType}
          acceptsCustomOrdersNow={acceptsCustomOrdersNow}
          shopPaused={shopPaused}
          pickupAvailable={pickupAvailable}
          deliveryAvailable={deliveryAvailable}
          shippingAvailable={shippingAvailable}
          currency={currency}
          onSellerType={(value) => {
            applySellerType(value)
            setChoiceSheetMode(null)
          }}
          onToggleCustomOrdersNow={() => {
            setAcceptsCustomOrdersNow((value) => !value)
          }}
          onToggleShopPaused={() => {
            setShopPaused((value) => !value)
          }}
          onTogglePickup={() => {
            setPickupAvailable((value) => !value)
            clearVisibleError('fulfillment')
            clearVisibleError('pickupAddress')
          }}
          onToggleDelivery={() => {
            setDeliveryAvailable((value) => !value)
            clearVisibleError('fulfillment')
          }}
          onToggleShipping={() => {
            setShippingAvailable((value) => !value)
            clearVisibleError('fulfillment')
          }}
          onCurrency={(value) => {
            setCurrency(value)
            setCurrencySource('USER_SELECTED')
            setRegionCode(regionCode || detectedCurrency.regionCode)
            clearVisibleError('priceRange')
            setChoiceSheetMode(null)
          }}
        />
        <PhoneOtpModal
          visible={phoneOtpVisible}
          phone={normalizePhoneForStorage(phone)}
          code={phoneOtpCode}
          error={phoneOtpError}
          sending={phoneOtpSending}
          verifying={phoneOtpVerifying}
          onChangeCode={(value) => {
            setPhoneOtpCode(value.replace(/\D/g, '').slice(0, 6))
            if (phoneOtpError) setPhoneOtpError('')
          }}
          onVerify={verifyPhoneOtpCode}
          onResend={resendPhoneOtpCode}
          onClose={() => {
            phoneOtpAfterVerifyRef.current = null
            setPhoneOtpVisible(false)
            setPhoneOtpCode('')
            setPhoneOtpError('')
          }}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

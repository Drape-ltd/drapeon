import { useCallback, useEffect, useMemo, useState } from 'react'
import { styles } from '@/features/tailor-profile/profile-home-styles'
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Linking,
} from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import * as ImageManipulator from 'expo-image-manipulator'
import { invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { pickAvatarImageUri, type AvatarImageSource } from '@/lib/avatar-picker'
import { isLikelyConnectivityIssue } from '@/lib/function-errors'
import { deriveTailorReadiness } from '@/lib/tailor-readiness'
import { uploadPublicStorageImage } from '@/lib/storage-upload'
import { useTailorDashboard, useTailorPublic, useTailorNotifCount } from '@/lib/queries'
import { useTailorProfile } from '@/lib/tailorProfile'
import { shareTailorProfile, inviteTailorColleague, inviteCustomerFromTailor } from '@/lib/invite'
import { appendToHistory, resetTo } from '@/lib/navigation'
import { Sentry } from '@/lib/sentry'
import { Colors } from '@/constants/theme'
import { AvatarImage } from '@/components/ui/AvatarImage'
import { useDrapeCapsuleNavScroll } from '@/components/ui/DrapeCapsuleNav'

type TailorProfile = {
  id: string
  displayName: string
  location: string
  bio: string | null
  sellerType: 'TAILOR' | 'BOUTIQUE' | 'TAILOR_SHOP'
  tier: string
  avgRating: number
  totalOrders: number
  totalReviews: number
  availability: string
  specialtyTags: string[]
  supportsCustomOrders: boolean
  supportsReadyMade: boolean
  acceptsCustomOrdersNow: boolean
  shopPaused: boolean
  pickupAvailable: boolean
  deliveryAvailable: boolean
  shippingAvailable: boolean
  shipsInternationally: boolean
  idVerificationStatus: string
  isLive: boolean
  profileCompleted: boolean
  stripeAccountId: string | null
  paystackAccountId: string | null
  payoutCurrency: string | null
  payoutProvider: string | null
  payoutReverificationRequired: boolean | null
  payoutAccountVerified: boolean | null
  payoutAccountType: 'PAYSTACK' | 'STRIPE_CONNECT' | null
}

const AVAIL_LABEL: Record<string, string> = {
  OPEN: 'Available',
  LIMITED: 'Limited',
  FULLY_BOOKED: 'Fully booked',
}
const AVAIL_COLOR: Record<string, string> = {
  OPEN: Colors.success,
  LIMITED: Colors.warning,
  FULLY_BOOKED: Colors.error,
}

const LIVE_BADGE: Record<string, { label: string; color: string; bg: string; dot: boolean }> = {
  LIVE: { label: 'Live', color: Colors.success, bg: Colors.success + '25', dot: true },
  PENDING: { label: 'In review', color: Colors.warning, bg: Colors.warning + '22', dot: false },
  REJECTED: { label: 'Action needed', color: Colors.error, bg: Colors.error + '18', dot: false },
  NOT_SUBMITTED: { label: 'Setup needed', color: Colors.midGrey, bg: Colors.lightGrey, dot: false },
}

export default function TailorProfileScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const capsuleNavScroll = useDrapeCapsuleNavScroll()
  const { user, signOut, switchRole } = useAuth()
  const { avatarUrl, setAvatarUrl, refreshAvatar } = useTailorProfile()
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [switchingRole, setSwitchingRole] = useState(false)
  const userId = user?.id
  const displayName = user?.user_metadata?.display_name ?? ''
  const dashboardQuery = useTailorDashboard(userId, displayName)
  const refetchDashboard = dashboardQuery.refetch
  const dashboardStats = dashboardQuery.data?.stats ?? null
  const profileId = dashboardStats?.profileId ?? undefined
  const publicProfileQuery = useTailorPublic(profileId, userId)
  const refetchPublicProfile = publicProfileQuery.refetch
  const publicProfile = publicProfileQuery.data?.profile ?? null

  const profile = useMemo<TailorProfile | null>(() => {
    if (!dashboardStats?.profileId && !publicProfile?.id) return null
    return {
      id: dashboardStats?.profileId ?? publicProfile!.id,
      displayName: publicProfile?.displayName ?? dashboardStats?.displayName ?? displayName,
      location: publicProfile?.location ?? '',
      bio: publicProfile?.bio ?? null,
      sellerType: publicProfile?.sellerType ?? 'TAILOR',
      tier: publicProfile?.tier ?? dashboardStats?.tier ?? 'VERIFIED',
      avgRating: publicProfile?.avgRating ?? dashboardStats?.avgRating ?? 0,
      totalOrders: publicProfile?.totalOrders ?? dashboardStats?.completedOrders ?? 0,
      totalReviews: publicProfile?.totalReviews ?? 0,
      availability: publicProfile?.availability ?? dashboardStats?.availability ?? 'OPEN',
      specialtyTags: publicProfile?.specialtyTags ?? [],
      supportsCustomOrders: publicProfile?.supportsCustomOrders ?? true,
      supportsReadyMade: publicProfile?.supportsReadyMade ?? false,
      acceptsCustomOrdersNow: publicProfile?.acceptsCustomOrdersNow ?? true,
      shopPaused: publicProfile?.shopPaused ?? false,
      pickupAvailable: publicProfile?.pickupAvailable ?? false,
      deliveryAvailable: publicProfile?.deliveryAvailable ?? false,
      shippingAvailable: publicProfile?.shippingAvailable ?? false,
      shipsInternationally: false,
      idVerificationStatus: dashboardStats?.idVerificationStatus ?? 'NOT_SUBMITTED',
      isLive: dashboardStats?.isLive ?? false,
      profileCompleted: dashboardStats?.profileCompleted ?? false,
      stripeAccountId: null,
      paystackAccountId: null,
      payoutCurrency: dashboardStats?.payoutCurrency ?? null,
      payoutProvider: dashboardStats?.payoutProvider ?? null,
      payoutReverificationRequired: dashboardStats?.payoutReverificationRequired ?? null,
      payoutAccountVerified: dashboardStats?.payoutAccountVerified ?? null,
      payoutAccountType: dashboardStats?.payoutAccountType ?? null,
    }
  }, [dashboardStats, displayName, publicProfile])

  const loading =
    dashboardQuery.isLoading ||
    (!!profileId && publicProfileQuery.isLoading && !publicProfile && !profile)
  const fetchErrorMessage =
    !loading && dashboardQuery.error
      ? isLikelyConnectivityIssue(dashboardQuery.error)
        ? 'Connection looks weak. Your storefront details should still be there once the signal stabilizes, so retry when it improves.'
        : 'Your profile is where customers judge trust, portfolio, and reviews. Please try again in a moment.'
      : ''
  const lastTailorNotifCheck =
    user?.user_metadata?.last_tailor_notif_check ?? new Date(0).toISOString()
  const { data: tailorNotifCount = 0 } = useTailorNotifCount(userId, lastTailorNotifCheck)

  async function openExternalUrl(url: string, fallbackMessage: string) {
    const supported = await Linking.canOpenURL(url)
    if (!supported) {
      Alert.alert('Unable to open link', fallbackMessage)
      return
    }

    try {
      await Linking.openURL(url)
    } catch {
      Alert.alert('Unable to open link', fallbackMessage)
    }
  }

  const initials =
    displayName
      .split(' ')
      .map((p: string) => p[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'

  useEffect(() => {
    if (publicProfile?.avatarUrl) setAvatarUrl(publicProfile.avatarUrl)
  }, [publicProfile?.avatarUrl, setAvatarUrl])

  useFocusEffect(
    useCallback(() => {
      void refreshAvatar()
      void refetchDashboard()
      if (profileId) void refetchPublicProfile()
    }, [profileId, refetchDashboard, refetchPublicProfile, refreshAvatar]),
  )

  // ── Avatar upload ────────────────────────────────────────────────────────────

  function handleAvatarPress() {
    Alert.alert('Profile photo', 'Take a new photo or choose one from your library.', [
      { text: 'Take photo', onPress: () => void updateAvatarFromSource('camera') },
      { text: 'Choose from library', onPress: () => void updateAvatarFromSource('library') },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  async function updateAvatarFromSource(source: AvatarImageSource) {
    const imageUri = await pickAvatarImageUri(source)
    if (!imageUri) return

    setUploadingAvatar(true)
    try {
      const compressed = await ImageManipulator.manipulateAsync(
        imageUri,
        [{ resize: { width: 800, height: 800 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
      )

      const fileName = `${user!.id}/avatar.jpg`
      const publicUrl = await uploadPublicStorageImage({
        bucket: 'avatars',
        path: fileName,
        uri: compressed.uri,
        contentType: 'image/jpeg',
        maxBytes: 5 * 1024 * 1024,
        upsert: true,
      })

      const bustUrl = `${publicUrl}?t=${Date.now()}`

      const { error: profileError } = await invokeFunction('tailor-profile-action', {
        body: { action: 'update-avatar', avatarUrl: bustUrl },
      })
      if (profileError) throw profileError

      setAvatarUrl(bustUrl)
    } catch (err) {
      Sentry.captureException(err, { extra: { context: 'tailor_avatar_upload', userId: user?.id } })
      Alert.alert(
        'Upload failed',
        isLikelyConnectivityIssue(err)
          ? 'Connection looks weak. We could not update your photo yet. Retry when the signal improves.'
          : 'Could not update your photo right now. Please try again in a moment.'
      )
    } finally {
      setUploadingAvatar(false)
    }
  }

  function handleSignOut() {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          void signOut().catch(() => {
            Alert.alert(
              'Unable to sign out',
              'Please try again in a moment. Your storefront settings are still here, so you can keep working and sign out later.'
            )
          })
        },
      },
    ])
  }

  function switchToCustomerMode() {
    if (switchingRole) return
    Alert.alert(
      'Use Drapeon as a customer',
      'Your tailor workspace stays intact. We will open the customer side so you can browse, order, and manage your own fit profile.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          onPress: () => {
            setSwitchingRole(true)
            void switchRole('CUSTOMER')
              .then(({ error }) => {
                if (error) {
                  Alert.alert('Could not switch modes', error)
                  return
                }
                resetTo(router, '/(customer)')
              })
              .finally(() => setSwitchingRole(false))
          },
        },
      ]
    )
  }

  const idStatus = profile?.idVerificationStatus ?? 'NOT_SUBMITTED'
  const readiness = deriveTailorReadiness(profile)

  // Live status badge config
  const liveBadgeKey = profile?.isLive
    ? 'LIVE'
    : idStatus in LIVE_BADGE
      ? idStatus
      : 'NOT_SUBMITTED'
  const liveBadge = LIVE_BADGE[liveBadgeKey]

  if (fetchErrorMessage && !userId) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Tailor profile</Text>
            <Text style={styles.stateTitle}>Couldn't load your profile.</Text>
            <Text style={styles.stateHint}>{fetchErrorMessage}</Text>
            <TouchableOpacity
              style={styles.statePrimaryBtn}
              onPress={() => {
                void dashboardQuery.refetch()
                if (profileId) void publicProfileQuery.refetch()
              }}
            >
              <Text style={styles.statePrimaryBtnText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.stateSecondaryBtn}
              onPress={() => router.replace('/(tailor)')}
            >
              <Text style={styles.stateSecondaryBtnText}>Open dashboard</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.profileHeader}>
          <Text style={styles.profileHeaderTitle}>Profile</Text>
        </View>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Tailor profile</Text>
            <ActivityIndicator color={Colors.needleGreen} size="large" />
            <Text style={styles.stateTitle}>Loading your profile…</Text>
            <Text style={styles.stateHint}>
              We’re pulling together your live profile, reviews, and profile status.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          style={styles.scroll}
          {...capsuleNavScroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom + 112, 140) },
          ]}
        >
          {/* ── Profile header strip ── */}
          <View style={styles.profileHeader}>
            <Text style={styles.profileHeaderTitle}>Profile</Text>
            <TouchableOpacity
              style={styles.bellBtn}
              onPress={() => router.push('/(tailor)/profile/notifications')}
              activeOpacity={0.7}
            >
              <Feather name="bell" size={20} color={Colors.ink} />
              {tailorNotifCount > 0 && (
                <View style={styles.bellBadge}>
                  <Text style={styles.bellBadgeText}>
                    {tailorNotifCount > 9 ? '9+' : String(tailorNotifCount)}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          {/* ── Hero ── */}
          <View style={styles.hero}>
            <TouchableOpacity
              style={styles.avatarWrap}
              onPress={handleAvatarPress}
              disabled={uploadingAvatar}
              activeOpacity={0.8}
            >
              {uploadingAvatar ? (
                <View style={[styles.avatar, styles.avatarLoading]}>
                  <ActivityIndicator color={Colors.textInverse} />
                </View>
              ) : (
                <AvatarImage
                  uri={avatarUrl}
                  initials={initials}
                  size={76}
                  style={styles.avatarImage}
                  shadow
                />
              )}
              <View style={styles.cameraBadge}>
                <Feather name="camera" size={11} color={Colors.textInverse} />
              </View>
              {profile && (
                <View
                  style={[
                    styles.liveIndicator,
                    { backgroundColor: profile.isLive ? Colors.success : Colors.midGrey },
                  ]}
                />
              )}
            </TouchableOpacity>

            <View style={styles.heroTextBlock}>
              <Text style={styles.heroName} numberOfLines={1}>
                {profile?.displayName ?? displayName}
              </Text>

              {profile?.location ? (
                <View style={styles.heroLocationRow}>
                  <Feather name="map-pin" size={12} color={Colors.inkLight} />
                  <Text style={styles.heroLocation} numberOfLines={1}>{profile.location}</Text>
                </View>
              ) : null}

              {profile && (
                <View style={styles.pillRow}>
                  <View style={styles.availPill}>
                    <View
                      style={[
                        styles.availDot,
                        { backgroundColor: AVAIL_COLOR[profile.availability] ?? Colors.midGrey },
                      ]}
                    />
                    <Text style={styles.availText}>
                      {AVAIL_LABEL[profile.availability] ?? profile.availability}
                    </Text>
                  </View>
                  <View style={styles.liveBadge}>
                    {liveBadge.dot && (
                      <View style={[styles.liveDot, { backgroundColor: liveBadge.color }]} />
                    )}
                    <Text style={styles.liveBadgeText}>{liveBadge.label}</Text>
                  </View>
                </View>
              )}
            </View>
          </View>

          <View style={styles.body}>
            {profile && (
              <View style={styles.capabilityCard}>
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.capabilityTitle}>Selling setup</Text>
                  <TouchableOpacity onPress={() => router.push('/(tailor)/profile/edit')}>
                    <Text style={styles.cardHeaderAction}>Edit</Text>
                  </TouchableOpacity>
                </View>
                <CapabilityRow
                  icon="briefcase"
                  label="Storefront"
                  value={
                    profile.sellerType === 'BOUTIQUE'
                      ? 'Boutique'
                      : profile.sellerType === 'TAILOR_SHOP'
                        ? 'Tailor shop'
                        : 'Independent tailor'
                  }
                />
                {profile.supportsCustomOrders ? (
                  <CapabilityRow
                    icon="scissors"
                    label="Custom orders"
                    value={profile.acceptsCustomOrdersNow ? 'Open' : 'Paused'}
                  />
                ) : null}
                {profile.supportsReadyMade ? (
                  <CapabilityRow
                    icon="shopping-bag"
                    label="Ready-made shop"
                    value={profile.shopPaused ? 'Paused' : 'Open'}
                  />
                ) : null}
                {!profile.supportsCustomOrders && !profile.supportsReadyMade ? (
                  <CapabilityRow icon="shopping-bag" label="Offers" value="Nothing enabled yet" />
                ) : null}
                <CapabilityRow
                  icon="map-pin"
                  label="Fulfillment"
                  value={[
                    profile.pickupAvailable ? 'Pickup' : null,
                    profile.deliveryAvailable ? 'Delivery' : null,
                    profile.shippingAvailable ? 'Shipping' : null,
                  ].filter(Boolean).join(' · ') || 'Not configured'}
                  last={!profile.shipsInternationally}
                />
                {profile.shipsInternationally ? (
                  <CapabilityRow icon="globe" label="International" value="Shipping enabled" last />
                ) : null}
              </View>
            )}

            {profile ? (
              <TouchableOpacity
                style={styles.trustStatusRow}
                onPress={() => router.push('/(tailor)/profile/trust-access' as never)}
                activeOpacity={0.75}
              >
                <View style={styles.trustStatusIcon}>
                  <Feather
                    name={readiness.tone === 'success' ? 'shield' : 'alert-circle'}
                    size={15}
                    color={readiness.tone === 'warning' ? Colors.warning : Colors.needleGreen}
                  />
                </View>
                <View style={styles.trustStatusCopy}>
                  <Text style={styles.trustStatusTitle}>Trust & access</Text>
                  <Text style={styles.trustStatusMeta} numberOfLines={1}>
                    {readiness.payoutProviderLabel
                      ? `${readiness.title} · ${readiness.payoutProviderLabel}`
                      : readiness.title}
                  </Text>
                </View>
                <Text style={styles.trustStatusAction}>{readiness.actionLabel ? 'Fix' : 'View'}</Text>
                <Feather name="chevron-right" size={16} color={Colors.midGrey} />
              </TouchableOpacity>
            ) : null}

            {/* ── No profile CTA ── */}
            {(!profile || !profile.profileCompleted) && (
              <TouchableOpacity
                style={styles.setupCard}
                onPress={() => router.push('/(tailor)/profile/setup')}
                activeOpacity={0.7}
              >
                <View style={styles.setupIconWrap}>
                  <Feather name="user-check" size={22} color={Colors.needleGreen} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.setupTitle}>Complete your profile</Text>
                  <Text style={styles.setupHint}>Add bio, portfolio, and ID to go live</Text>
                </View>
                <Feather name="chevron-right" size={18} color={Colors.midGrey} />
              </TouchableOpacity>
            )}

            {/* ── Stats ── */}
            {profile && (
              <View style={styles.statsRow}>
                <StatPill
                  first
                  label="Rating"
                  value={profile.avgRating > 0 ? profile.avgRating.toFixed(1) : 'No rating'}
                  sub={profile.avgRating > 0 ? '★' : undefined}
                  onPress={() => router.push('/(tailor)/profile/reviews')}
                />
                <StatPill
                  label="Reviews"
                  value={String(profile.totalReviews)}
                  onPress={() => router.push('/(tailor)/profile/reviews')}
                />
                <StatPill
                  label="Orders"
                  value={String(profile.totalOrders)}
                  onPress={() =>
                    router.push({
                      pathname: '/(tailor)/orders',
                      params: {
                        tab: 'completed',
                        historyChain: appendToHistory(undefined, '/(tailor)/profile'),
                      },
                    })
                  }
                />
              </View>
            )}

            {/* ── Profile actions ── */}
            <View style={styles.flatList}>
              <FlatRow
                icon="star"
                label="What’s new"
                onPress={() => router.push('/(tailor)/profile/whats-new')}
              />
              <FlatRow
                icon="book-open"
                label="Drapeon guide & help"
                onPress={() => router.push('/(tailor)/profile/help')}
              />
              {profile?.isLive && (
                <FlatRow
                  icon="share-2"
                  label="Share my live profile"
                  onPress={() => shareTailorProfile(profile.id, profile.displayName)}
                />
              )}
              {profile?.supportsReadyMade && (
                <FlatRow
                  icon="shopping-bag"
                  label="Manage shop items"
                  onPress={() => router.push('/(tailor)/shop')}
                />
              )}
              <FlatRow
                icon="user-plus"
                label="Invite a client"
                onPress={() =>
                  inviteCustomerFromTailor(profile?.id ?? '', profile?.displayName ?? displayName)
                }
              />
              <FlatRow
                icon="scissors"
                label="Invite a fellow tailor"
                last
                onPress={() => inviteTailorColleague(user?.id ?? '', displayName)}
              />
            </View>

            {/* ── Account ── */}
            <View style={styles.flatList}>
              <FlatRow
                icon="shopping-bag"
                label={switchingRole ? 'Opening customer mode...' : 'Use Drapeon as a customer'}
                onPress={switchToCustomerMode}
              />
              <FlatRow
                icon="settings"
                label="Account settings"
                onPress={() => router.push('/(tailor)/profile/account-settings')}
              />
              <FlatRow
                icon="file-text"
                label="Legal"
                last
                onPress={() => {
                  void openExternalUrl(
                    'https://drapeon.co/legal',
                    'Please visit https://drapeon.co/legal manually.'
                  )
                }}
              />
            </View>

            {/* ── Sign out ── */}
            <TouchableOpacity
              style={styles.logOutRow}
              onPress={handleSignOut}
              activeOpacity={0.6}
              accessibilityRole="button"
              accessibilityLabel="Sign out"
            >
              <Feather name="log-out" size={18} color={Colors.error} />
              <Text style={styles.logOutText}>Sign out</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  )
}

// ─── StatPill ─────────────────────────────────────────────────────────────────

function StatPill({
  label,
  value,
  sub,
  first,
  onPress,
}: {
  label: string
  value: string
  sub?: string
  first?: boolean
  onPress?: () => void
}) {
  const content = (
    <>
      <View style={styles.statValueRow}>
        <Text style={styles.statValue}>{value}</Text>
        {sub && <Text style={styles.statSub}>{sub}</Text>}
      </View>
      <Text style={styles.statLabel}>{label}</Text>
    </>
  )

  if (onPress) {
    return (
      <TouchableOpacity style={[styles.statPill, first && styles.statPillFirst]} onPress={onPress} activeOpacity={0.75}>
        {content}
      </TouchableOpacity>
    )
  }

  return <View style={[styles.statPill, first && styles.statPillFirst]}>{content}</View>
}

function CapabilityRow({
  icon,
  label,
  value,
  last,
}: {
  icon: React.ComponentProps<typeof Feather>['name']
  label: string
  value: string
  last?: boolean
}) {
  return (
    <View style={[styles.capabilityRow, last && styles.capabilityRowLast]}>
      <View style={styles.capabilityIcon}>
        <Feather name={icon} size={15} color={Colors.midGrey} />
      </View>
      <Text style={styles.capabilityRowLabel}>{label}</Text>
      <Text style={styles.capabilityRowValue} numberOfLines={2}>{value}</Text>
    </View>
  )
}

// ─── FlatRow ──────────────────────────────────────────────────────────────────

function FlatRow({
  icon,
  label,
  last,
  onPress,
}: {
  icon: React.ComponentProps<typeof Feather>['name']
  label: string
  last?: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity
      style={[styles.flatRow, last && styles.rowLast]}
      onPress={onPress}
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Feather
        name={icon}
        size={20}
        color={Colors.inkLight}
        style={{ width: 24 }}
      />
      <Text style={styles.flatRowLabel}>{label}</Text>
      <Feather name="chevron-right" size={16} color={Colors.midGrey} />
    </TouchableOpacity>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

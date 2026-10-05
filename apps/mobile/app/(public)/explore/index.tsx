import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { fetchReadGateway } from '@/lib/read-gateway'
import { RemoteImage } from '@/components/ui'
import { SkeletonBlock } from '@/components/ui/Skeleton'
import { DrapePressScale, DrapeRise, useReduceMotion } from '@/components/ui/DrapeEntrance'
import { formatAmount, useCurrency, type CurrencyCode } from '@/lib/currency'
import { Colors, Fonts, FontWeight, Radius, Spacing } from '@/constants/theme'
import type { StorageImageBucket } from '@/lib/image-url'
import { EXPLORE_COVER_ASPECT_RATIO, EXPLORE_COVER_POSITION, resolveExploreCover } from '@/lib/explore-cover'

/** Matches the signed-in explore grid so the marketplace does not change shape at sign-in. */
const CARD_IMAGE_RATIO = EXPLORE_COVER_ASPECT_RATIO

/**
 * A generic placeholder tells you a search box exists. These tell you what this particular
 * marketplace holds, which is the thing a first-time visitor has no way to guess.
 */
const SEARCH_HINTS = ['agbada', 'tailors in Accra', 'aso-ebi', 'kaftan', 'bridal', 'ankara']
const HINT_INTERVAL = 2800

/** Cross-fades through the hints while the field is empty and unfocused. */
function RotatingHint({ reduceMotion }: { reduceMotion: boolean }) {
  const [index, setIndex] = useState(0)
  const progress = useSharedValue(1)

  useEffect(() => {
    if (reduceMotion) return
    const timer = setInterval(() => {
      // Fade out, swap the word while it is invisible, hold briefly so React commits the
      // new text, then fade the next one up. One sequence, so the word never changes
      // mid-fade.
      progress.value = withSequence(
        withTiming(0, { duration: 260 }, (finished) => {
          if (finished) runOnJS(setIndex)((current) => (current + 1) % SEARCH_HINTS.length)
        }),
        withTiming(0, { duration: 70 }),
        withTiming(1, { duration: 320 }),
      )
    }, HINT_INTERVAL)
    return () => clearInterval(timer)
  }, [progress, reduceMotion])

  const motionStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 7 }],
  }))

  return (
    <View style={styles.hintRow} pointerEvents="none">
      <Text style={styles.hintStatic}>Search </Text>
      <Animated.Text style={[styles.hintStatic, motionStyle]} numberOfLines={1}>
        {SEARCH_HINTS[index]}
      </Animated.Text>
    </View>
  )
}

/** Grid-shaped loading state. A spinner in empty space says nothing about what is coming. */
function CardSkeleton({ width }: { width: number }) {
  return (
    <View style={{ width }}>
      <SkeletonBlock style={{ width: '100%', height: Math.round(width * CARD_IMAGE_RATIO), borderRadius: 14 }} />
      <View style={styles.cardInfo}>
        <SkeletonBlock style={styles.skeletonLineWide} />
        <SkeletonBlock style={styles.skeletonLineNarrow} />
      </View>
    </View>
  )
}

type PublicTailor = {
  id: string
  display_name?: string | null
  location?: string | null
  specialty_tags?: unknown
  avg_rating?: number | null
  total_reviews?: number | null
  availability?: string | null
  supports_custom_orders?: boolean | null
  supports_ready_made?: boolean | null
  portfolio_photo_urls?: unknown
  portfolio_video_urls?: unknown
  explore_image_url?: string | null
  explore_image_bucket?: StorageImageBucket | null
  avatar_url?: string | null
  price_range_min?: number | null
  currency?: string | null
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

/**
 * Frameless, two-up, and priced the same way the signed-in grid is. A visitor's first
 * impression of the marketplace should be the marketplace, not a different app that
 * swaps shape the moment they sign in.
 */
function TailorCard({
  tailor,
  width,
  viewerCurrency,
  rates,
  reduceMotion,
  enterDelay,
  onPress,
}: {
  tailor: PublicTailor
  width: number
  viewerCurrency: CurrencyCode
  rates: Parameters<typeof formatAmount>[3]
  reduceMotion: boolean
  enterDelay: number
  onPress: () => void
}) {
  const specialties = stringList(tailor.specialty_tags).slice(0, 2)
  const portfolioCount = new Set([
    ...stringList(tailor.portfolio_photo_urls),
    ...stringList(tailor.portfolio_video_urls),
  ]).size
  const rating = tailor.avg_rating ?? 0
  const cover = resolveExploreCover(tailor)
  const priceCurrency = (tailor.currency ?? 'USD').toUpperCase() as CurrencyCode
  // price_range_min is stored in minor units, so it must go through formatAmount, which
  // divides by 100. formatMoney would render these a hundred times too large.
  const priceLabel = tailor.price_range_min
    ? `From ${formatAmount(tailor.price_range_min, priceCurrency, priceCurrency, rates)}`
    : null
  const convertedLabel = tailor.price_range_min && priceCurrency !== viewerCurrency
    ? `≈${formatAmount(tailor.price_range_min, priceCurrency, viewerCurrency, rates)}`
    : null

  return (
    <DrapeRise delay={enterDelay} distance={16} reduceMotion={reduceMotion}>
      <DrapePressScale
        style={[styles.card, { width }]}
        reduceMotion={reduceMotion}
        onPress={onPress}
        accessibilityLabel={`View ${tailor.display_name ?? 'tailor'} public profile${portfolioCount > 0 ? ' and portfolio' : ''}`}
      >
        <View style={[styles.cardImageWrap, { height: Math.round(width * CARD_IMAGE_RATIO) }]}>
          <RemoteImage
            uri={cover.uri}
            bucket={cover.bucket ?? undefined}
            style={styles.cardImage}
            contentFit="cover"
            contentPosition={EXPLORE_COVER_POSITION}
            surface="public_explore"
          />
          {portfolioCount > 1 ? (
            <View style={styles.portfolioBadge}>
              <Feather name="image" size={11} color={Colors.textInverse} />
              <Text style={styles.portfolioBadgeText}>{portfolioCount}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.cardInfo}>
          <View style={styles.cardTopLine}>
            <Text style={styles.cardName} numberOfLines={1}>
              {tailor.display_name ?? 'Drapeon tailor'}
            </Text>
            {rating > 0 ? (
              <View style={styles.cardRating}>
                <Feather name="star" size={10} color={Colors.ink} />
                <Text style={styles.cardRatingText}>{rating.toFixed(1)}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.cardMeta} numberOfLines={1}>
            {tailor.location ?? 'Location not listed'}
          </Text>
          <Text style={styles.cardMeta} numberOfLines={1}>
            {specialties.join(' · ') || 'Custom and ready-made'}
          </Text>
          {priceLabel ? (
            <Text style={styles.cardPrice} numberOfLines={1}>
              {priceLabel}
              {convertedLabel ? <Text style={styles.cardPriceAlt}> {convertedLabel}</Text> : null}
            </Text>
          ) : null}
        </View>
      </DrapePressScale>
    </DrapeRise>
  )
}

export default function PublicExploreScreen() {
  const router = useRouter()
  const { width: screenWidth } = useWindowDimensions()
  // One currency hook for the screen. Per card it would fire a rate fetch per tailor.
  const { currency: viewerCurrency, rates } = useCurrency()
  const cardWidth = Math.floor((screenWidth - Spacing.lg * 2 - Spacing.xl) / 2)
  const [tailors, setTailors] = useState<PublicTailor[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const reduceMotion = useReduceMotion()

  const load = useCallback(
    async (forceRefresh = false, offset = 0) => {
      setError('')
      if (offset > 0) setLoadingMore(true)
      try {
        const data = await fetchReadGateway<PublicTailor[]>(
          { action: 'explore-tailors', limit: 30, offset, query: query.trim() },
          { forceRefresh }
        )
        setTailors((current) => {
          if (offset === 0) return data
          const seen = new Set(current.map((tailor) => tailor.id))
          return [...current, ...data.filter((tailor) => !seen.has(tailor.id))]
        })
        setHasMore(data.length === 30)
      } catch {
        setError(
          'We could not load public profiles right now. Check your connection and try again.'
        )
      } finally {
        setLoading(false)
        setRefreshing(false)
        setLoadingMore(false)
      }
    },
    [query]
  )

  useEffect(() => {
    const timer = setTimeout(
      () => {
        void load()
      },
      query.trim() ? 350 : 0
    )
    return () => clearTimeout(timer)
  }, [load, query])

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.accountButton}
          onPress={() => router.push('/(auth)/welcome')}
          accessibilityRole="button"
          accessibilityLabel="Continue to Drapeon account"
        >
          <Text style={styles.accountButtonText}>Sign in</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true)
              void load(true)
            }}
          />
        }
      >
        {/* Straight to search. This is a browse surface, not a landing page, so the
            tailors start on the first screen rather than under a headline. */}
        <View style={styles.searchWrap}>
          <Feather name="search" size={19} color={Colors.midGrey} />
          <View style={styles.searchField}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder={searchFocused || reduceMotion ? 'Search style, specialty, or location' : ''}
              placeholderTextColor={Colors.midGrey}
              style={styles.searchInput}
              returnKeyType="search"
              accessibilityLabel="Search public tailor profiles by style, specialty, or location"
            />
            {!query && !searchFocused && !reduceMotion ? <RotatingHint reduceMotion={reduceMotion} /> : null}
          </View>
        </View>

        {loading ? (
          <View style={styles.grid}>
            {Array.from({ length: 6 }, (_, index) => (
              <CardSkeleton key={index} width={cardWidth} />
            ))}
          </View>
        ) : null}
        {error ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>Explore is taking a moment.</Text>
            <Text style={styles.stateBody}>{error}</Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={() => {
                setLoading(true)
                void load(true)
              }}
            >
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {!loading && !error && tailors.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>
              {query.trim() ? `No tailors match “${query.trim()}”` : 'No tailors to show yet'}
            </Text>
            <Text style={styles.emptyBody}>
              {query.trim()
                ? 'Try a different style, specialty, or city.'
                : 'Approved tailors will appear here as they join.'}
            </Text>
          </View>
        ) : null}

        {!loading && !error ? (
          <View style={styles.grid}>
            {tailors.map((tailor, index) => (
              <TailorCard
                key={tailor.id}
                tailor={tailor}
                width={cardWidth}
                viewerCurrency={viewerCurrency}
                rates={rates}
                reduceMotion={reduceMotion}
                // Only the first screenful staggers. Past that the delay would outlast the
                // scroll and cards would arrive after you had already reached them.
                enterDelay={Math.min(index, 5) * 70}
                onPress={() =>
                  router.push({
                    pathname: '/(public)/explore/tailor/[id]',
                    params: { id: tailor.id },
                  })
                }
              />
            ))}
            {hasMore ? (
              <TouchableOpacity
                style={styles.loadMoreButton}
                onPress={() => {
                  void load(false, tailors.length)
                }}
                disabled={loadingMore}
                accessibilityRole="button"
                accessibilityLabel="Load more approved tailors"
              >
                {loadingMore ? (
                  <ActivityIndicator color={Colors.textInverse} />
                ) : (
                  <Text style={styles.loadMoreText}>Load more tailors</Text>
                )}
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: {
    minHeight: 60,
    paddingHorizontal: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    backgroundColor: Colors.bone,
  },
  accountButton: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.ink,
    backgroundColor: Colors.bone,
  },
  accountButtonText: {
    color: Colors.ink,
    fontFamily: Fonts.bodySemiBold,
    fontWeight: FontWeight.semibold,
  },
  content: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxxl },
  // Same pill the signed-in explore uses, so search looks like one feature across both.
  searchWrap: {
    minHeight: 56,
    marginTop: Spacing.sm,
    marginBottom: Spacing.lg,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: Radius.full,
    backgroundColor: Colors.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.lightGrey,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    shadowColor: Colors.ink,
    shadowOpacity: 0.07,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  searchField: { flex: 1, justifyContent: 'center' },
  searchInput: { fontFamily: Fonts.body, fontSize: 16, color: Colors.ink },
  // Sits over the input rather than in its placeholder, because a placeholder string
  // cannot be animated on its own.
  hintRow: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', alignItems: 'center' },
  hintStatic: { fontFamily: Fonts.body, fontSize: 16, color: Colors.midGrey },
  skeletonLineWide: { width: '72%', height: 12, borderRadius: 6 },
  skeletonLineNarrow: { width: '46%', height: 12, borderRadius: 6, marginTop: 6 },
  stateCard: {
    padding: Spacing.xl,
    borderRadius: Radius.xl,
    backgroundColor: Colors.white,
    gap: Spacing.sm,
  },
  stateTitle: { fontFamily: Fonts.display, fontSize: 24, color: Colors.ink },
  stateBody: { fontFamily: Fonts.body, lineHeight: 22, color: Colors.inkLight },
  retryButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen,
  },
  retryText: { color: Colors.textInverse, fontWeight: FontWeight.semibold },
  emptyState: { paddingTop: Spacing.xl, paddingBottom: Spacing.xxl, gap: Spacing.xs },
  emptyTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 16, fontWeight: FontWeight.semibold, color: Colors.ink },
  emptyBody: { fontFamily: Fonts.body, fontSize: 14, lineHeight: 20, color: Colors.midGrey },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.xl, rowGap: Spacing.xl },
  // No card chrome. The rounded image is the card and the text sits directly on the page,
  // which is how the signed-in grid reads.
  card: { backgroundColor: 'transparent' },
  cardImageWrap: {
    width: '100%',
    position: 'relative',
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: Colors.lightGrey,
  },
  cardImage: { width: '100%', height: '100%' },
  portfolioBadge: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    minHeight: 26,
    paddingHorizontal: 9,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(26,26,24,0.76)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  portfolioBadgeText: { color: Colors.textInverse, fontSize: 11, fontWeight: FontWeight.semibold },
  cardInfo: { paddingHorizontal: 2, paddingTop: 10, gap: 2 },
  cardTopLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  cardName: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  cardRating: { flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: 'auto' },
  cardRatingText: { fontSize: 12, lineHeight: 17, color: Colors.ink },
  cardMeta: { fontSize: 12, lineHeight: 17, color: Colors.midGrey },
  cardPrice: { fontSize: 12, lineHeight: 17, color: Colors.ink },
  cardPriceAlt: { color: Colors.midGrey },
  loadMoreButton: {
    width: '100%',
    minHeight: 48,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  loadMoreText: {
    color: Colors.ink,
    fontFamily: Fonts.bodySemiBold,
    fontWeight: FontWeight.semibold,
  },
})

import AsyncStorage from '@react-native-async-storage/async-storage'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Linking,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useNavigation, useRouter } from 'expo-router'
import {
  getVisibleProductUpdates,
  type ProductUpdate,
  type ProductUpdateRole,
} from '@drape/shared/product-updates'
import { Colors, Fonts, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'
import { captureLifecycleEvent } from '@/lib/analytics'
import { goBackOrFallback } from '@/lib/navigation'

type ProductUpdatesScreenProps = {
  role: Exclude<ProductUpdateRole, 'ALL'>
  fallbackRoute: string
}

const READ_STATE_VERSION = 1

function readStateKey(role: ProductUpdateRole) {
  return `drapeon.product-updates.${role.toLowerCase()}.v${READ_STATE_VERSION}`
}

function nativeUpdateRoute(update: ProductUpdate, role: ProductUpdateRole) {
  if (update.id === 'fit-profile-2026-09' && role === 'CUSTOMER') {
    return { kind: 'internal' as const, path: '/(customer)/profile/measurements' }
  }

  if (update.route) {
    return { kind: 'external' as const, url: `https://drapeon.co${update.route}` }
  }

  return null
}

export function ProductUpdatesScreen({ role, fallbackRoute }: ProductUpdatesScreenProps) {
  const router = useRouter()
  const navigation = useNavigation()
  const surface = Platform.OS === 'android' ? 'android' : 'ios'
  const updates = useMemo(() => getVisibleProductUpdates({ surface, role }), [role, surface])
  const [readUpdateIds, setReadUpdateIds] = useState<Set<string>>(() => new Set())
  const hydratedReadRoleRef = useRef<ProductUpdateRole | null>(null)

  useEffect(() => {
    let active = true
    void AsyncStorage.getItem(readStateKey(role)).then((raw) => {
      if (!active || !raw) return
      try {
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) return
        setReadUpdateIds(new Set(parsed.filter((value): value is string => typeof value === 'string')))
      } catch {
        // A malformed local read marker must never block the updates feed.
      }
    }).catch(() => {
      // Read state is an enhancement; storage outages must not block the feed.
    }).finally(() => {
      if (active) hydratedReadRoleRef.current = role
    })
    return () => {
      active = false
      if (hydratedReadRoleRef.current === role) hydratedReadRoleRef.current = null
    }
  }, [role])

  useEffect(() => {
    if (hydratedReadRoleRef.current !== role) return
    void AsyncStorage.setItem(readStateKey(role), JSON.stringify([...readUpdateIds])).catch(() => {
      // The in-memory marker remains useful for this visit if persistence is unavailable.
    })
  }, [readUpdateIds, role])

  function markRead(updateId: string) {
    setReadUpdateIds((current) => {
      const next = new Set(current)
      next.add(updateId)
      return next
    })
  }

  function goBack() {
    goBackOrFallback(router, navigation, fallbackRoute as never)
  }

  async function openUpdate(update: ProductUpdate) {
    const destination = nativeUpdateRoute(update, role)
    if (!destination) return
    if (destination.kind === 'internal') {
      router.push(destination.path as never)
      markRead(update.id)
      captureLifecycleEvent('product_update_opened', {
        update_id: update.id,
        entry_surface: surface,
        release: update.release,
      })
      return
    }

    try {
      const supported = await Linking.canOpenURL(destination.url)
      if (!supported) throw new Error('Link unavailable')
      await Linking.openURL(destination.url)
      markRead(update.id)
      captureLifecycleEvent('product_update_opened', {
        update_id: update.id,
        entry_surface: surface,
        release: update.release,
      })
    } catch {
      // A failed deep link is a negative path; do not report it as adoption.
      Alert.alert('Could not open this update', 'The update is still here. Please try again, or open Drapeon on the web.')
    }
  }

  return (
    <View style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Feather name="arrow-left" size={20} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>What’s new</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        accessibilityLabel="Drapeon product updates"
      >
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>DRAPEON UPDATES</Text>
          <Text style={styles.title}>Small changes, clearer work.</Text>
          <Text style={styles.subtitle}>
            A short list of improvements that make ordering and working with Drapeon easier.
          </Text>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Latest from Drapeon</Text>
          <Text style={styles.sectionMeta}>{updates.length} {updates.length === 1 ? 'update' : 'updates'}</Text>
        </View>

        {updates.length > 0 ? updates.map((update) => {
          const destination = nativeUpdateRoute(update, role)
          return (
            <View key={update.id} style={styles.card}>
              <View style={styles.cardTopline}>
                <Text style={styles.release}>{update.release}</Text>
                <View style={styles.readState} accessibilityLabel={readUpdateIds.has(update.id) ? 'Read update' : 'New update'}>
                  <Text style={styles.readStateText}>{readUpdateIds.has(update.id) ? 'Read' : 'New'}</Text>
                  <Feather name={readUpdateIds.has(update.id) ? 'check' : 'star'} size={16} color={readUpdateIds.has(update.id) ? Colors.needleGreen : Colors.kanteRust} />
                </View>
              </View>
              <Text style={styles.cardTitle}>{update.title}</Text>
              <Text style={styles.cardSummary}>{update.summary}</Text>
              {destination ? (
                <TouchableOpacity
                  style={styles.cta}
                  onPress={() => { void openUpdate(update) }}
                  activeOpacity={0.82}
                  accessibilityRole="button"
                  accessibilityLabel={update.ctaLabel ?? 'Open update'}
                >
                  <Text style={styles.ctaText}>{update.ctaLabel ?? 'Learn more'}</Text>
                  <Feather name="arrow-up-right" size={16} color={Colors.white} />
                </TouchableOpacity>
              ) : null}
            </View>
          )
        }) : (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <Feather name="check-circle" size={22} color={Colors.needleGreen} />
            </View>
            <Text style={styles.emptyTitle}>You’re up to date.</Text>
            <Text style={styles.emptyText}>There are no updates for this workspace right now.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: {
    minHeight: 64,
    paddingHorizontal: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.lightGrey,
    backgroundColor: Colors.bone,
  },
  backButton: { width: 40, height: 40, justifyContent: 'center' },
  headerTitle: { color: Colors.ink, fontFamily: Fonts.body, fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  hero: { marginBottom: Spacing.xl },
  eyebrow: { color: Colors.needleGreen, fontFamily: Fonts.body, fontSize: FontSize.xs, fontWeight: FontWeight.bold, letterSpacing: 1.8, marginBottom: Spacing.sm },
  title: { color: Colors.ink, fontFamily: Fonts.display, fontSize: 32, lineHeight: 38, marginBottom: Spacing.sm },
  subtitle: { color: Colors.inkLight, fontFamily: Fonts.body, fontSize: FontSize.md, lineHeight: 23, maxWidth: 420 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: Spacing.md },
  sectionTitle: { color: Colors.ink, fontFamily: Fonts.body, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  sectionMeta: { color: Colors.midGrey, fontFamily: Fonts.body, fontSize: FontSize.sm },
  card: { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg, marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.lightGrey },
  cardTopline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  release: { color: Colors.needleGreen, fontFamily: Fonts.body, fontSize: FontSize.xs, fontWeight: FontWeight.bold, letterSpacing: 1.2 },
  readState: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  readStateText: { color: Colors.inkLight, fontFamily: Fonts.body, fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  cardTitle: { color: Colors.ink, fontFamily: Fonts.display, fontSize: 23, lineHeight: 28, marginBottom: Spacing.sm },
  cardSummary: { color: Colors.inkLight, fontFamily: Fonts.body, fontSize: FontSize.md, lineHeight: 23, marginBottom: Spacing.lg },
  cta: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.needleGreen },
  ctaText: { color: Colors.white, fontFamily: Fonts.body, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  emptyCard: { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.xl, alignItems: 'center', borderWidth: 1, borderColor: Colors.lightGrey },
  emptyIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.needleGreen + '14', alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md },
  emptyTitle: { color: Colors.ink, fontFamily: Fonts.display, fontSize: 23, marginBottom: Spacing.xs },
  emptyText: { color: Colors.inkLight, fontFamily: Fonts.body, fontSize: FontSize.md, lineHeight: 22, textAlign: 'center' },
})

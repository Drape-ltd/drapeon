import { useMemo, useState, type ComponentProps } from 'react'
import { ActivityIndicator, Alert, Linking, Platform, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather, Ionicons } from '@expo/vector-icons'
import Svg, { Path } from 'react-native-svg'
import { colors, darkColors } from '@drape/shared/design-system'
import { useAuth } from '@/lib/auth'
import { DrapePressScale, DrapeRise, useReduceMotion } from '@/components/ui/DrapeEntrance'
import { DrapeCardStack, type DrapeStackCard } from '@/components/ui/DrapeCardStack'
import { SKETCH_LOOKS } from '@/assets/welcome/sketches'
import { Fonts, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'

/**
 * Four starter looks rendered from the Studio's own illustrator, so the first screen
 * shows what someone will actually make here rather than stock craft photography. The
 * captions describe the same garments the Studio names, which keeps the welcome screen
 * honest: nothing here is an invented listing, price, or tailor.
 *
 * Regenerate by rendering `renderIllustration` against the `curated` entries named
 * Celebration, Pattern & presence, After hours, and Soft tailoring in packages/drape-studio.
 */
const STUDIO_LOOKS: DrapeStackCard[] = SKETCH_LOOKS

type Palette = { background: string; surface: string; ink: string; muted: string; line: string; green: string; greenDark: string }
const light: Palette = { background: colors.background, surface: colors.surface, ink: colors.textPrimary, muted: colors.textSecondary, line: colors.border, green: colors.primary, greenDark: colors.primaryDark }
const dark: Palette = { background: darkColors.background, surface: darkColors.secondaryActionBg, ink: darkColors.textPrimary, muted: darkColors.textSecondary, line: darkColors.border, green: darkColors.statusSuccess, greenDark: darkColors.statusSuccess }

function GoogleMark() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4z" />
      <Path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z" />
      <Path fill="#FBBC05" d="M6.4 14a6 6 0 0 1 0-3.9V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14z" />
      <Path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.8A9.7 9.7 0 0 0 3.1 7.4l3.3 2.7C7.2 7.7 9.4 5.9 12 5.9z" />
    </Svg>
  )
}

/**
 * A sign-in provider reduced to its mark. Apple permits the logo without the wordmark
 * when the other provider buttons are also unlabelled, which is the case here, so every
 * option reads at the same weight instead of three stacked full-width bars.
 */
function ProviderTile({
  children,
  label,
  busy,
  tint,
  ...props
}: ComponentProps<typeof DrapePressScale> & { label: string; busy?: boolean; tint: string }) {
  return (
    <DrapePressScale
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!props.disabled, busy: !!busy }}
      {...props}
    >
      {busy ? <ActivityIndicator color={tint} /> : children}
    </DrapePressScale>
  )
}

export default function WelcomeScreen() {
  const router = useRouter()
  const { signInWithApple, signInWithGoogle } = useAuth()
  const [providerLoading, setProviderLoading] = useState<'apple' | 'google' | null>(null)
  const isDark = useColorScheme() === 'dark'
  const palette = isDark ? dark : light
  const styles = useMemo(() => makeStyles(palette), [palette])
  const reduceMotion = useReduceMotion()

  async function continueWith(provider: 'apple' | 'google') {
    if (providerLoading) return
    setProviderLoading(provider)
    const result = provider === 'apple' ? await signInWithApple() : await signInWithGoogle()
    setProviderLoading(null)
    if (result.error) Alert.alert(`${provider === 'apple' ? 'Apple' : 'Google'} sign-in failed`, result.error)
  }

  async function openLegal(url: string) {
    try {
      if (!await Linking.canOpenURL(url)) throw new Error('unsupported')
      await Linking.openURL(url)
    } catch {
      Alert.alert('Unable to open link', `Please visit ${url.replace('https://', '')} manually.`)
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.stage}>
          <DrapeRise delay={120} distance={26} reduceMotion={reduceMotion}>
            <DrapeCardStack cards={STUDIO_LOOKS} reduceMotion={reduceMotion} />
          </DrapeRise>
          {/* Names what the cards are doing, which "Looks you can build in the Studio"
              got wrong: Studio is a sketch pad, so building a look is not a feature it
              has. A caption rather than a link because /studio bounces to this screen
              without a session. */}
          <DrapeRise delay={560} reduceMotion={reduceMotion}>
            <Text style={styles.stageCaption}>Sketch the idea. Find the tailor.</Text>
          </DrapeRise>
        </View>

        <DrapeRise delay={720} reduceMotion={reduceMotion} style={styles.actions}>
          <DrapePressScale style={styles.exploreButton} reduceMotion={reduceMotion} onPress={() => router.push('/(public)/explore')} accessibilityLabel="Explore Drapeon without an account">
            <Text style={styles.exploreLabel}>Explore Drapeon</Text>
            <Feather name="arrow-right" size={19} color={colors.textInverse} />
          </DrapePressScale>

          <View style={styles.dividerRow}><View style={styles.divider} /><Text style={styles.dividerText}>or</Text><View style={styles.divider} /></View>

          <View style={styles.providerRow}>
            {Platform.OS === 'ios' ? (
              <ProviderTile
                style={styles.providerTile}
                reduceMotion={reduceMotion}
                onPress={() => { void continueWith('apple') }}
                busy={providerLoading === 'apple'}
                disabled={!!providerLoading}
                label="Continue with Apple"
                tint={palette.ink}
              >
                <Ionicons name="logo-apple" size={24} color={palette.ink} />
              </ProviderTile>
            ) : null}

            <ProviderTile
              style={styles.providerTile}
              reduceMotion={reduceMotion}
              onPress={() => { void continueWith('google') }}
              busy={providerLoading === 'google'}
              disabled={!!providerLoading}
              label="Continue with Google"
              tint={palette.ink}
            >
              <GoogleMark />
            </ProviderTile>

            <ProviderTile
              style={styles.providerTile}
              reduceMotion={reduceMotion}
              onPress={() => router.push('/(auth)/sign-in')}
              disabled={!!providerLoading}
              label="Continue with email"
              tint={palette.ink}
            >
              <Feather name="mail" size={23} color={palette.ink} />
            </ProviderTile>
          </View>

          <Text style={styles.legal}>By continuing, you agree to our <Text style={styles.link} onPress={() => { void openLegal('https://drapeon.co/terms') }}>Terms</Text> and acknowledge our <Text style={styles.link} onPress={() => { void openLegal('https://drapeon.co/privacy') }}>Privacy Policy</Text>.</Text>
        </DrapeRise>
      </ScrollView>
    </SafeAreaView>
  )
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: p.background },
    content: { flexGrow: 1, padding: Spacing.xl, paddingBottom: Spacing.xxl },
    stage: { flex: 1, minHeight: 240, justifyContent: 'center', alignItems: 'center' },
    stageCaption: { color: p.muted, fontFamily: Fonts.bodyMedium, fontSize: 12, fontWeight: FontWeight.medium, letterSpacing: 0.1, marginTop: Spacing.sm },
    actions: { gap: Spacing.md },
    // Label and arrow sit together in the middle. Pushed to opposite edges the arrow reads
    // as a disclosure chevron on a list row rather than forward motion on a button.
    exploreButton: { minHeight: 56, borderRadius: Radius.lg, paddingHorizontal: Spacing.lg, backgroundColor: p.green, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
    exploreLabel: { color: colors.textInverse, fontFamily: Fonts.bodySemiBold, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
    dividerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginVertical: Spacing.xs },
    divider: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: p.line },
    dividerText: { color: p.muted, fontFamily: Fonts.body, fontSize: 11 },
    providerRow: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.md, paddingTop: Spacing.xs },
    providerTile: { width: 86, height: 56, borderRadius: Radius.md, backgroundColor: p.surface, borderWidth: 1, borderColor: p.line, alignItems: 'center', justifyContent: 'center' },
    legal: { color: p.muted, fontFamily: Fonts.body, fontSize: 11, lineHeight: 16, textAlign: 'center' },
    link: { color: p.greenDark, fontFamily: Fonts.bodyMedium, fontWeight: FontWeight.medium },
  })
}

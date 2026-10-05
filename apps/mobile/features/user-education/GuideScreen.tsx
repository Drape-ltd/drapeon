import { ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { useUserRole } from '@/lib/auth'
import { goBackOrReturnTo } from '@/lib/navigation'
import { useContextualBackHandler } from '@/lib/use-contextual-back'
import { getGuide, GUIDE_ROOMS } from '@drape/shared/guide-library'
import { GuideLibrary } from './GuideLibrary'
import { GuideReader } from './GuideReader'
import { EducationHelp } from './EducationHelp'
import { GuideButton, s } from './GuidePrimitives'
function safeGuideLibraryReturn(value?: string) {
  if (
    !value ||
    value.length > 2000 ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[\\\r\n]/.test(value)
  )
    return '/guide'
  return /^\/guide(?:[/?#]|$)/.test(value) || /^\/\((?:tailor|customer)\)\/messages\/[a-z0-9-]+(?:\?.*)?$/i.test(value)
    ? value
    : '/guide'
}
export function GuideScreen() {
  const params = useLocalSearchParams<{ slug?: string; section?: string; returnTo?: string }>(),
    router = useRouter(),
    navigation = useNavigation(),
    role = useUserRole()
  const guide = params.slug ? getGuide(params.slug) : null
  const backTarget = safeGuideLibraryReturn(params.returnTo)
  const returnsToConversation = /^\/\((?:tailor|customer)\)\/messages\//.test(backTarget)
  const returnParams = new URL(backTarget, 'https://drapeon.local').searchParams
  const room = GUIDE_ROOMS.find((entry) => entry.category === returnParams.get('topic'))
  const back = () => {
    if (params.slug) {
      if (navigation.canGoBack() && !room) {
        router.back()
        return
      }
      router.replace(backTarget as never)
      return
    }
    if (navigation.canGoBack()) {
      router.back()
      return
    }
    goBackOrReturnTo(
      router,
      navigation,
      params.returnTo,
      (params.slug ? '/guide' : role === 'TAILOR' ? '/(tailor)' : '/(customer)') as never
    )
  }
  useContextualBackHandler(back)
  return (
    <SafeAreaView style={s.safe}>
      <View style={[s.row, { paddingHorizontal: 16, paddingBottom: 8 }]}>
        <GuideButton onPress={back}>
          {guide
            ? room
              ? `Back to ${room.title}`
              : returnsToConversation
                ? 'Back to conversation'
                : 'Back to Guide'
            : 'Back'}
        </GuideButton>
        <Text style={s.label}>DRAPEON GUIDE</Text>
      </View>
      <ScrollView
        key={params.slug || 'library'}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
      >
        {params.slug && !guide ? (
          <>
            <Text style={s.title}>This guide is unavailable</Text>
            <GuideButton onPress={() => router.replace('/guide' as never)}>
              Browse all guides
            </GuideButton>
          </>
        ) : guide ? (
          <GuideReader guide={guide} section={params.section} />
        ) : (
          <>
            <Text accessibilityRole="header" style={s.title}>
              A little knowledge. A better result.
            </Text>
            <Text style={s.body}>Create, measure and care with confidence.</Text>
            <GuideLibrary />
            <EducationHelp />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

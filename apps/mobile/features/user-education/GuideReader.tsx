import { GuideVideo } from './GuideVideo'
import { useState } from 'react'
import { Linking, Share, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import {
  GUIDE_UPDATED,
  getGuide,
  guidePublicUrl,
  type GuideArticle,
} from '@drape/shared/guide-library'
import { collectionsFrom } from '@drape/shared/education-state'
import { GuideButton, s } from './GuidePrimitives'
import { useEducation } from './use-education'
export function GuideReader({ guide, section }: { guide: GuideArticle; section?: string }) {
  const { store, state } = useEducation(),
    router = useRouter(),
    [notice, setNotice] = useState(''),
    [adding, setAdding] = useState(false)
    const saved = state.data[`saved:${guide.id}`] === true
  const share = (part?: string) => {
    void Share.share({ message: `${guide.title}\n${guidePublicUrl(guide.id, part)}` }).catch(() =>
      setNotice('Could not open sharing. Try again.')
    )
  }
  return (
    <View style={{ gap: 18 }}>
      <Text style={s.label}>
        {guide.category} · {guide.minutes} min
      </Text>
      <Text accessibilityRole="header" style={s.title}>
        {guide.title}
      </Text>
      <Text style={s.body}>{guide.summary}</Text>
      <GuideVideo guideId={guide.id}/>
      <View style={s.row}>
        <GuideButton
          disabled={!state.ready}
          selected={saved}
          onPress={() => void store.set(`saved:${guide.id}`, !saved).catch(() => {})}
        >
          {saved ? 'Saved · remove' : 'Save guide'}
        </GuideButton>
        <GuideButton onPress={() => share()}>Share guide</GuideButton>
        <GuideButton onPress={() => setAdding(!adding)}>Add to collection</GuideButton>
      </View>
      <Text accessibilityLiveRegion="polite" style={s.muted}>
        {notice ||
          state.error ||
          'Written steps are included in the app and available offline. Videos and source websites need a connection.'}
      </Text>
      {adding && (
        <View style={s.card}>
          {collectionsFrom(state.data).length ? (
            collectionsFrom(state.data).map(([key, c]) => (
              <GuideButton
                key={key}
                onPress={() => {
                  const ids = [...new Set([...c.guideIds, guide.id])]
                  if (ids.length > 8) {
                    setNotice('A collection holds up to eight guides.')
                    return
                  }
                  void store
                    .set(key, { ...c, guideIds: ids })
                    .then(() => {
                      setAdding(false)
                      setNotice('Added to collection.')
                    })
                    .catch(() => {})
                }}
              >
                {c.title}
              </GuideButton>
            ))
          ) : (
            <Text style={s.body}>Create a collection in Guide → My collections first.</Text>
          )}
        </View>
      )}
      {section && (
        <View style={s.notice}>
          <Text style={s.heading}>Shared section</Text>
          <Text style={s.body}>{guide.sections.find((s) => s.id === section)?.title}</Text>
        </View>
      )}
      {guide.sections.map((part, i) => (
        <View
          key={part.id}
          style={[s.card, section === part.id && { borderColor: '#ad7950', borderWidth: 2 }]}
        >
          <Text accessibilityRole="header" style={s.heading}>
            {i + 1}. {part.title}
          </Text>
          <Text style={s.body}>{part.body}</Text>
          <GuideButton onPress={() => share(part.id)}>Share this section</GuideButton>
        </View>
      ))}
      <View style={s.notice}>
        <Text style={s.heading}>Keep in mind</Text>
        <Text style={s.body}>{guide.mistakes}</Text>
      </View>
      <Text style={s.muted}>
        By Drapeon · Updated {GUIDE_UPDATED} · Version {guide.version}
      </Text>
      {guide.sources.length > 0 && (
        <View style={s.card}>
          <Text style={s.heading}>Sources & further reading</Text>
          {guide.sources.map((src) => (
            <GuideButton
              key={src.url}
              onPress={() =>
                void Linking.openURL(src.url).catch(() =>
                  setNotice('This source needs an internet connection.')
                )
              }
            >
              {src.title}
            </GuideButton>
          ))}
          <Text style={s.muted}>
            General educational guidance. Follow the maker’s instructions for the actual garment.
          </Text>
        </View>
      )}
      <Text style={s.heading}>Continue learning</Text>
      {guide.related.map((id) => (
        <GuideButton
          key={id}
          onPress={() =>
            router.push({
              pathname: '/guide/[slug]',
              params: { slug: id, returnTo: `/guide/${guide.id}` },
            } as never)
          }
        >
          {getGuide(id)?.title || id}
        </GuideButton>
      ))}
    </View>
  )
}

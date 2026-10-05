import { useState } from 'react'
import { Text, TextInput, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { GUIDE_ROOMS, searchGuides, getGuide, guideShareText } from '@drape/shared/guide-library'
import { collectionsFrom } from '@drape/shared/education-state'
import { useEducation } from './use-education'
import { GuideButton, s } from './GuidePrimitives'
export function GuideLibrary({ onSelect }: { onSelect?: (body: string) => void }) {
  const params = useLocalSearchParams<{
    returnTo?: string
    topic?: string
    view?: string
    q?: string
  }>()
  const { state, store, owner } = useEducation(),
    router = useRouter(),
    [tab, setTab] = useState(params.view || 'Explore'),
    [query, setQuery] = useState(params.q || ''),
    [category, setCategory] = useState(params.topic || ''),
    [title, setTitle] = useState('')
  const setRoom = (room: string) => {
    setCategory(room)
    if (!onSelect) router.setParams({ topic: room || undefined } as never)
  }
  const lessonReturnTo = () => {
    const route = new URLSearchParams()
    if (params.returnTo) route.set('returnTo', params.returnTo)
    if (category) route.set('topic', category)
    if (tab !== 'Explore') route.set('view', tab)
    if (query) route.set('q', query)
    const search = route.toString()
    return `/guide${search ? `?${search}` : ''}`
  }
  const guides = searchGuides(query, category).filter(
      (g) => tab !== 'Saved' || state.data[`saved:${g.id}`] === true
    ),
    collections = collectionsFrom(state.data)
  return (
    <View style={{ gap: 16 }}>
      <View style={s.row}>
        {['Explore', 'Saved', 'My collections'].map((t) => (
          <GuideButton key={t} selected={tab === t} onPress={() => setTab(t)}>
            {t}
          </GuideButton>
        ))}
      </View>
      <Text accessibilityLiveRegion="polite" style={s.muted}>
        {!state.ready
          ? 'Loading your library…'
          : state.error ||
            (state.syncing
              ? 'Syncing…'
              : !owner
                ? 'Guest preferences stay on this device.'
                : state.pending
                  ? 'Device copy saved · account sync pending'
                  : 'Your account library is up to date.')}
      </Text>
      {state.error && <GuideButton onPress={() => void store.sync()}>Retry sync</GuideButton>}
      {tab === 'My collections' ? (
        <>
          <Text style={s.body}>
            Group up to eight guides in reading order. Collections are private; sending one shares
            its selected lessons.
          </Text>
          <TextInput
            accessibilityLabel="Collection name"
            value={title}
            onChangeText={setTitle}
            maxLength={80}
            placeholder="Before your fitting"
            style={s.input}
          />
          <GuideButton
            disabled={!state.ready || !title.trim() || collections.length >= 30}
            onPress={() => {
              void store
                .set(
                  `collection:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
                  { title: title.trim(), guideIds: [] }
                )
                .then(() => setTitle(''))
                .catch(() => {})
            }}
          >
            Create collection
          </GuideButton>
          {!collections.length && (
            <Text style={s.body}>
              Your collections will appear here. Open any guide to add it to a collection.
            </Text>
          )}
          {collections.map(([key, c]) => (
            <View style={s.card} key={key}>
              <Text style={s.heading}>{c.title}</Text>
              {!c.guideIds.length && (
                <Text style={s.body}>Open a guide and choose Add to collection.</Text>
              )}
              {c.guideIds.map((id, i) => (
                <View key={id} style={{ gap: 6 }}>
                  <Text style={s.body}>
                    {i + 1}. {getGuide(id)?.title}
                  </Text>
                  <View style={s.row}>
                    <GuideButton
                      onPress={() =>
                        router.push({
                          pathname: '/guide/[slug]',
                          params: { slug: id, returnTo: lessonReturnTo() },
                        } as never)
                      }
                    >
                      Read
                    </GuideButton>
                    {i > 0 && (
                      <GuideButton
                        onPress={() => {
                          const ids = [...c.guideIds]
                          ;[ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]
                          void store.set(key, { ...c, guideIds: ids }).catch(() => {})
                        }}
                      >
                        Move up
                      </GuideButton>
                    )}
                    <GuideButton
                      onPress={() =>
                        void store
                          .set(key, { ...c, guideIds: c.guideIds.filter((g) => g !== id) })
                          .catch(() => {})
                      }
                    >
                      Remove
                    </GuideButton>
                  </View>
                </View>
              ))}
              {onSelect && c.guideIds.length > 0 && (
                <GuideButton selected onPress={() => onSelect(guideShareText(c.guideIds))}>
                  Add collection to message
                </GuideButton>
              )}
              <GuideButton onPress={() => void store.set(key, null).catch(() => {})}>
                Delete collection
              </GuideButton>
            </View>
          ))}
        </>
      ) : (
        <>
          <TextInput
            accessibilityLabel="Search guides"
            value={query}
            onChangeText={setQuery}
            placeholder="Sleeves, kids, embroidery…"
            style={s.input}
          />
          {!category && !query && tab === 'Explore' ? (
            <View style={{ gap: 16 }}>
              {GUIDE_ROOMS.map((room) => (
                <View key={room.category} style={s.card}>
                  <Text style={s.label}>{searchGuides('', room.category).length} sections</Text>
                  <Text style={s.heading}>{room.title}</Text>
                  <Text style={s.body}>{room.description}</Text>
                  <Text style={s.muted}>{room.topics}</Text>
                  <GuideButton onPress={() => setRoom(room.category)}>
                    Open {room.title.toLowerCase()}
                  </GuideButton>
                </View>
              ))}
            </View>
          ) : (
            <>
              {category && (
                <View style={{ gap: 12 }}>
                  <GuideButton
                    onPress={() => {
                      setRoom('')
                      setQuery('')
                    }}
                  >
                    ← All guide rooms
                  </GuideButton>
                  <Text style={s.heading}>
                    {GUIDE_ROOMS.find((r) => r.category === category)?.title}
                  </Text>
                </View>
              )}
              <Text accessibilityLiveRegion="polite" style={s.muted}>
                {guides.length} guides
              </Text>
              {guides.map((g) => (
                <View key={g.id} style={s.card}>
                  <Text style={s.label}>
                    {g.category} · {g.minutes} min
                  </Text>
                  <Text accessibilityRole="header" style={s.heading}>
                    {g.title}
                  </Text>
                  <Text style={s.body}>{g.summary}</Text>
                  <GuideButton
                    selected
                    onPress={() =>
                      onSelect
                        ? onSelect(guideShareText([g.id]))
                        : router.push({
                            pathname: '/guide/[slug]',
                            params: { slug: g.id, returnTo: lessonReturnTo() },
                          } as never)
                    }
                  >
                    {onSelect ? 'Add to message' : 'Read guide'}
                  </GuideButton>
                </View>
              ))}
              {!guides.length && (
                <Text style={s.body}>
                  {tab === 'Saved'
                    ? 'Save a guide while reading it to find it here.'
                    : 'No matches. Try a shorter phrase or a different topic.'}
                </Text>
              )}
            </>
          )}
        </>
      )}
    </View>
  )
}

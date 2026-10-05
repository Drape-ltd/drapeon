import { useState } from 'react'
import { Text, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { GUIDE_VIDEOS } from '@drape/shared/guide-library'
import { GuideButton, s } from './GuidePrimitives'
export function GuideVideo({ guideId }: { guideId: string }) {
  const video = GUIDE_VIDEOS[guideId],
    [playing, setPlaying] = useState(false),
    [failed, setFailed] = useState(false)
  if (!video) return null
  return (
    <View style={s.notice}>
      <Text style={s.label}>WATCH & FOLLOW ALONG · {video.creator}</Text>
      <Text style={s.heading}>{video.title}</Text>
      <Text style={s.body}>{video.description}</Text>
      {playing && !failed ? (
        <WebView
          style={{ height: 230, backgroundColor: '#172c22' }}
          source={{
            uri: `https://www.youtube.com/embed/${video.youtubeId}?playsinline=1&rel=0`,
            headers: { Referer: 'https://drapeon.co/' },
          }}
          accessibilityLabel={`${video.title} video player`}
          allowsInlineMediaPlayback
          allowsFullscreenVideo
          mediaPlaybackRequiresUserAction
          setSupportMultipleWindows={false}
          onError={() => setFailed(true)}
          onHttpError={() => setFailed(true)}
          onShouldStartLoadWithRequest={(request) =>
            request.url.startsWith('https://www.youtube.com/embed/') ||
            request.url === 'about:blank'
          }
        />
      ) : (
        <GuideButton
          onPress={() => {
            setFailed(false)
            setPlaying(true)
          }}
        >
          {failed ? 'Retry video' : '▶ Watch here'}
        </GuideButton>
      )}
      {failed && (
        <Text style={s.muted}>
          Video could not load. Check your connection or follow the written steps below.
        </Text>
      )}
      {playing && <GuideButton onPress={() => setPlaying(false)}>Close video</GuideButton>}
      <Text style={s.muted}>
        Video by {video.creator}. Plays here through YouTube and needs a connection. Written steps
        remain available offline.
      </Text>
    </View>
  )
}

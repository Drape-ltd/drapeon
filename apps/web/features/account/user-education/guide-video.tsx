'use client'
import { useState } from 'react'
import { GUIDE_VIDEOS } from '@drape/shared/guide-library'
import styles from './guide.module.css'
export function GuideVideoPlayer({ guideId }: { guideId: string }) {
  const video = GUIDE_VIDEOS[guideId],
    [playing, setPlaying] = useState(false)
  if (!video) return null
  return (
    <div className={styles.video}>
      <p className={styles.eyebrow}>Watch & follow along · {video.creator}</p>
      <h2>{video.title}</h2>
      <p>{video.description}</p>
      {playing ? (
        <>
          <iframe
            className={styles.player}
            title={`${video.title} — ${video.creator}`}
            src={`https://www.youtube.com/embed/${video.youtubeId}?playsinline=1&rel=0`}
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
          <button type="button" className={styles.quiet} onClick={() => setPlaying(false)}>
            Close video
          </button>
        </>
      ) : (
        <button className={styles.videoLoad} type="button" onClick={() => setPlaying(true)}>
          <span aria-hidden="true">▶</span> Watch here
        </button>
      )}
      <p className={styles.videoNote}>
        Video by {video.creator} · Plays here through YouTube. Needs an internet connection. Written
        steps are below.
      </p>
    </div>
  )
}

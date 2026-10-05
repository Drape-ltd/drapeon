import styles from './guide.module.css'
import { GuideContextLink } from './guide-navigation'
import { getGuide, GUIDE_UPDATED, type GuideArticle } from '@drape/shared/guide-library'
import { GuideVideoPlayer } from './guide-video'
import { GuideActions } from './guide-actions'
export function GuideReader({ guide }: { guide: GuideArticle }) {
  return (
    <article className={styles.reading}>
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-needle">
          {guide.category} · {guide.minutes} min read
        </p>
        <h1 className="mt-3 text-3xl leading-tight sm:text-5xl">{guide.title}</h1>
        <p className="mt-3 text-lg leading-7 text-ink/65">{guide.summary}</p>
      </div>
      <GuideVideoPlayer guideId={guide.id} />
      <GuideActions guide={guide} />
      <nav aria-label="On this page" className="rounded-xl bg-needle/5 p-5">
        <p className="mb-2 font-semibold">In this guide</p>
        {guide.sections.map((s, i) => (
          <a className="block py-1 text-sm text-needle underline" href={`#${s.id}`} key={s.id}>
            {i + 1}. {s.title}
          </a>
        ))}
      </nav>
      {guide.sections.map((s, i) => (
        <section id={s.id} key={s.id} className="scroll-mt-20 border-t border-ink/10 pt-6">
          <h2 className="text-2xl">
            {i + 1}. {s.title}
          </h2>
          <p className="mt-3 text-base leading-8">{s.body}</p>
          <GuideActions guide={guide} section={s.id} />
        </section>
      ))}
      <aside className="rounded-xl border-l-4 border-[#ae794e] bg-[#f4ebdf] p-5">
        <h2 className="font-semibold">Keep in mind</h2>
        <p className="mt-2 leading-7">{guide.mistakes}</p>
      </aside>
      <div className="text-sm text-ink/65">
        <p>
          By Drapeon · Updated {GUIDE_UPDATED} · Version {guide.version}
        </p>
        {guide.sources.length ? (
          <>
            <h2 className="mt-3 font-semibold">Sources & further reading</h2>
            <ul>
              {guide.sources.map((s) => (
                <li key={s.url}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block py-2 text-needle underline"
                  >
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
            <p>
              General educational guidance. Follow the maker’s instructions for the actual garment.
            </p>
          </>
        ) : (
          <p className="mt-2">
            Product guidance for Drapeon. Availability can vary by account and release.
          </p>
        )}
      </div>
      <section>
        <h2 className="mb-3 text-xl">Continue learning</h2>
        <div className="flex flex-wrap gap-3">
          {guide.related
            .map((id) => getGuide(id))
            .filter(Boolean)
            .map((g) => (
              <GuideContextLink
                key={g!.id}
                id={g!.id}
                className="rounded-full border border-needle/20 px-4 py-3 text-sm text-needle"
              >
                {g!.title}
              </GuideContextLink>
            ))}
        </div>
      </section>
    </article>
  )
}

import type { GuideArticle } from './guide-library'
import { GUIDE_UPDATED } from './guide-library'
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!
  )
export function guideOfflineHtml(guide: GuideArticle) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(guide.title)} · Drapeon Guide</title><style>body{font:18px/1.7 system-ui,sans-serif;background:#f7f5ed;color:#233e32;max-width:760px;margin:40px auto;padding:0 24px}h1{font:36px Georgia,serif}h2{font-size:23px}aside{padding:18px;background:#eee2d3}a{color:#285546}small{font-size:13px}</style><main><p>Drapeon Guide · ${escape(guide.category)}</p><h1>${escape(guide.title)}</h1><p>${escape(guide.summary)}</p>${guide.sections.map((s, i) => `<section id="${s.id}"><h2>${i + 1}. ${escape(s.title)}</h2><p>${escape(s.body)}</p></section>`).join('')}<aside><strong>Keep in mind</strong><p>${escape(guide.mistakes)}</p></aside><p><small>Offline reading copy · Version ${guide.version} · Updated ${GUIDE_UPDATED}. Source links require a connection.</small></p>${guide.sources.map((s) => `<p><a href="${escape(s.url)}">${escape(s.title)}</a></p>`).join('')}</main></html>`
}

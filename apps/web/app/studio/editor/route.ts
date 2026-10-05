import document from '../../../features/account/studio-workspace/studio-document.json'

export const dynamic = 'force-dynamic'

export async function GET() {
  return new Response(document.html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': `default-src 'none'; script-src 'sha256-${document.scriptHash}'; img-src data: blob:; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'; form-action 'none'`,
    },
  })
}

import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'
import { colors as brandColors } from '@drape/shared/design-system'

const WIDTH = 1200
const HEIGHT = 630

function clean(value: string | null, fallback: string, maxLength: number) {
  const normalized = value?.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()
  return (normalized || fallback).slice(0, maxLength)
}

export function GET(request: NextRequest) {
  const title = clean(request.nextUrl.searchParams.get('title'), 'Made for you, wherever you are.', 86)
  const description = clean(request.nextUrl.searchParams.get('description'), 'Discover approved tailors and keep every detail of the work in one place.', 180)
  const label = clean(request.nextUrl.searchParams.get('label'), 'Drapeon marketplace', 42)

  return new ImageResponse(
    (
      <div style={{ display: 'flex', width: '100%', height: '100%', background: brandColors.background, color: brandColors.textPrimary, padding: '42px', fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', width: '100%', height: '100%', overflow: 'hidden', borderRadius: '30px', border: `1px solid ${brandColors.border}`, background: brandColors.surface }}>
          <div style={{ display: 'flex', width: '68%', padding: '54px 58px', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', color: brandColors.primary, fontSize: 34, fontWeight: 800, letterSpacing: '-0.03em' }}>Drapeon</div>
              <div style={{ display: 'flex', borderRadius: '999px', border: `1px solid ${brandColors.primary}2e`, padding: '9px 16px', color: brandColors.primary, fontSize: 15, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em' }}>{label}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', maxWidth: '720px', fontSize: title.length > 58 ? 58 : 68, lineHeight: 0.98, fontWeight: 700, letterSpacing: '-0.045em' }}>{title}</div>
              <div style={{ display: 'flex', maxWidth: '690px', marginTop: '24px', fontSize: 23, lineHeight: 1.45, color: `${brandColors.textSecondary}cc` }}>{description}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: `${brandColors.textSecondary}a3`, fontSize: 17 }}>
              <div style={{ display: 'flex', width: '9px', height: '9px', borderRadius: '50%', background: brandColors.primary }} />
              drapeon.co
            </div>
          </div>
          <div style={{ display: 'flex', position: 'relative', width: '32%', background: brandColors.surfaceDark, flexDirection: 'column', justifyContent: 'space-between', padding: '52px 42px', color: brandColors.background }}>
            <div style={{ display: 'flex', position: 'absolute', width: '330px', height: '330px', border: `1px solid ${brandColors.background}1f`, borderRadius: '50%', right: '-125px', top: '-90px' }} />
            <div style={{ display: 'flex', position: 'absolute', width: '230px', height: '230px', border: `1px solid ${brandColors.background}1a`, borderRadius: '50%', right: '-70px', top: '-35px' }} />
            <div style={{ display: 'flex', fontSize: 15, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.18em', color: `${brandColors.background}8f` }}>One connected experience</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '17px' }}>
              {['Approved tailors', 'Clear project context', 'Visible progress'].map((item, index) => (
                <div key={item} style={{ display: 'flex', alignItems: 'center', gap: '13px', borderTop: `1px solid ${brandColors.background}24`, paddingTop: '17px', fontSize: 18, color: `${brandColors.background}d1` }}>
                  <div style={{ display: 'flex', color: `${brandColors.background}6b`, fontSize: 13 }}>0{index + 1}</div>{item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
      headers: { 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800' },
    }
  )
}

import { ImageResponse } from 'next/og'
import { colorScales, colors, illustrationColors } from '../../../packages/shared/src/design-system'

export const size = {
  width: 1200,
  height: 630,
}

export const contentType = 'image/png'

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          background: illustrationColors.deepCanvas,
          color: colors.background,
          padding: '64px 72px',
          flexDirection: 'column',
          justifyContent: 'space-between',
          fontFamily: 'sans-serif',
          position: 'relative',
        }}
      >
        {/* Subtle texture overlay */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              `radial-gradient(ellipse 80% 60% at 70% 80%, ${colors.primary}2e 0%, transparent 70%)`,
            display: 'flex',
          }}
        />

        {/* Top: wordmark + tagline pill */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }}>
          <div
            style={{
              fontSize: 38,
              fontWeight: 800,
              letterSpacing: '-0.03em',
              color: colors.background,
            }}
          >
            Drapeon
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              border: `1px solid ${colors.background}24`,
              borderRadius: '999px',
              padding: '10px 20px',
              background: `${colors.background}12`,
              color: `${colors.background}99`,
              fontSize: 18,
              fontWeight: 500,
              letterSpacing: '0.04em',
            }}
          >
            drapeon.co
          </div>
        </div>

        {/* Center: hero headline */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', position: 'relative' }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              fontSize: 90,
              lineHeight: 0.92,
              fontWeight: 800,
              letterSpacing: '-0.055em',
              color: colors.background,
            }}
          >
            <span>Fashion that fits</span>
            <span>before the first stitch.</span>
          </div>
          <div
            style={{
              fontSize: 28,
              lineHeight: 1.45,
              color: `${colors.background}8f`,
              maxWidth: '780px',
              fontWeight: 400,
            }}
          >
            Find a verified tailor, send a clear brief, and track your custom order from quote to delivery.
          </div>
        </div>

        {/* Bottom: feature pills */}
        <div style={{ display: 'flex', gap: '14px', position: 'relative' }}>
          {[
            { label: 'Verified tailors', dot: colors.primary },
            { label: 'Clear briefs', dot: colors.primary },
            { label: 'Protected orders', dot: colors.primary },
            { label: 'Track every stage', dot: colors.primary },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                borderRadius: '999px',
                padding: '12px 20px',
                background: `${colors.background}12`,
                border: `1px solid ${colors.background}1f`,
                fontSize: 20,
                fontWeight: 500,
                color: `${colors.background}c7`,
              }}
            >
              <div
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  background: colorScales.needle[400],
                  display: 'flex',
                }}
              />
              {item.label}
            </div>
          ))}
        </div>
      </div>
    ),
    size
  )
}

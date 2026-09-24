import { COLORS } from '../src/constants'
import { colorScales, colors, darkColors, illustrationColors } from '../src/design-system'

function relativeLuminance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))

  if (!channels || channels.length !== 3) {
    throw new Error(`Expected a six-digit hex color, received ${hex}`)
  }

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrastRatio(foreground: string, background: string) {
  const foregroundLuminance = relativeLuminance(foreground)
  const backgroundLuminance = relativeLuminance(background)
  const lightest = Math.max(foregroundLuminance, backgroundLuminance)
  const darkest = Math.min(foregroundLuminance, backgroundLuminance)

  return (lightest + 0.05) / (darkest + 0.05)
}

describe('Drape dark design system', () => {
  it('keeps normal and muted text readable on core surfaces', () => {
    expect(contrastRatio(darkColors.textSecondary, darkColors.background)).toBeGreaterThanOrEqual(
      4.5
    )
    expect(contrastRatio(darkColors.textSecondary, darkColors.surface)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(darkColors.textMuted, darkColors.background)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(darkColors.textMuted, darkColors.surface)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps borders visibly distinct from the dark canvas', () => {
    expect(contrastRatio(darkColors.border, darkColors.background)).toBeGreaterThanOrEqual(2)
  })

  it('keeps the adaptive brand foreground readable on dark surfaces', () => {
    expect(contrastRatio(darkColors.primaryDark, darkColors.primaryLight)).toBeGreaterThanOrEqual(
      4.5
    )
    expect(contrastRatio(darkColors.primaryDark, darkColors.surface)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('Drape light design system aliases', () => {
  it('keeps the legacy constants on the canonical shared palette', () => {
    expect(COLORS.needleGreen).toBe(colors.primary)
    expect(COLORS.kanteRust).toBe(colors.accent)
    expect(COLORS.inkBlack).toBe(colors.textPrimary)
    expect(COLORS.boneWhite).toBe(colors.background)
    expect(COLORS.midGrey).toBe(colors.textMuted)
  })

  it('keeps web shade ramps anchored to the semantic palette', () => {
    expect(colorScales.needle[50]).toBe(colors.primaryLight)
    expect(colorScales.needle[500]).toBe(colors.primary)
    expect(colorScales.needle[600]).toBe(colors.primaryDark)
    expect(colorScales.rust[500]).toBe(colors.accent)
  })

  it('keeps illustration anchors on the shared shade ramps', () => {
    expect(illustrationColors.canvas).toBe(colorScales.needle[900])
    expect(illustrationColors.surface).toBe(colorScales.needle[800])
    expect(illustrationColors.highlight).toBe(colorScales.needle[200])
    expect(illustrationColors.highlightSoft).toBe(colorScales.needle[100])
  })

  it('keeps illustration frames and highlights explicit', () => {
    for (const value of Object.values(illustrationColors)) {
      expect(value).toMatch(/^#[0-9A-F]{6}$/u)
    }
    expect(illustrationColors.frameCanvas).toBe('#17211C')
    expect(illustrationColors.cameraCanvas).toBe('#DED5C6')
    expect(illustrationColors.highlightMuted).toBe('#8CC5A8')
  })
})

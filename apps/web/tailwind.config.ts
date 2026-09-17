import type { Config } from 'tailwindcss'
import {
  colors as brandColors,
  colorScales,
  illustrationColors,
} from '../../packages/shared/src/design-system'

const config: Config = {
  // `features/` holds the account shell, profile, settings, payout and order
  // workspaces. It was missing here, so any utility used only in those files was
  // never generated — the mobile account header asked for `bg-ui-surface-dark/96`
  // and rendered transparent, leaving white text on a light page.
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './features/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Drapeon brand palette
        'drape-green': brandColors.primary,
        needle: {
          DEFAULT: brandColors.primary,
          ...colorScales.needle,
        },
        rust: {
          DEFAULT: brandColors.accent,
          ...colorScales.rust,
        },
        bone: brandColors.background,
        ink: brandColors.textPrimary,
        ui: {
          canvas: brandColors.background,
          surface: brandColors.surface,
          'surface-dark': brandColors.surfaceDark,
          muted: brandColors.statusMutedBg,
          border: brandColors.border,
          subtle: brandColors.textSecondary,
        },
        illustration: {
          canvas: illustrationColors.canvas,
          surface: illustrationColors.surface,
          highlight: illustrationColors.highlight,
          'highlight-soft': illustrationColors.highlightSoft,
          'frame-canvas': illustrationColors.frameCanvas,
          'frame-surface': illustrationColors.frameSurface,
          'camera-surface': illustrationColors.cameraSurface,
          'camera-canvas': illustrationColors.cameraCanvas,
          'deep-canvas': illustrationColors.deepCanvas,
          'overlay-canvas': illustrationColors.overlayCanvas,
          'label-surface': illustrationColors.labelSurface,
          'highlight-muted': illustrationColors.highlightMuted,
          'highlight-bright': illustrationColors.highlightBright,
          landmark: illustrationColors.landmark,
          'highlight-pale': illustrationColors.highlightPale,
          'highlight-on': illustrationColors.highlightOn,
          glow: illustrationColors.glow,
          'camera-overlay': illustrationColors.cameraOverlay,
          'camera-shadow': illustrationColors.cameraShadow,
          'landmark-border': illustrationColors.landmarkBorder,
        },
      },
      fontFamily: {
        sans: ['var(--font-body)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config

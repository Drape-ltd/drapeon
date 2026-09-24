import type { MetadataRoute } from 'next'
import { colors as brandColors } from '@drape/shared/design-system'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Drapeon',
    short_name: 'Drapeon',
    description: 'Custom fashion orders, fit context, and trusted tailors.',
    start_url: '/',
    display: 'standalone',
    background_color: brandColors.background,
    theme_color: brandColors.primary,
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}

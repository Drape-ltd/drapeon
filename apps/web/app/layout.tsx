import type { Metadata } from 'next'
import Script from 'next/script'
import * as React from 'react'
import { AuthLandingRedirect } from '../components/auth-landing-redirect'
import { BrandEntrance } from '../components/brand-entrance'
import { WebAnalytics } from '../components/web-analytics'
import { WebSessionScopeGuard } from '../components/web-session-scope-guard'
import { WebCapsLockSignal } from '../components/web-caps-lock-signal'
import { UiProvider } from '../components/ui/ui-provider'
import {
  defaultDescription,
  defaultTitle,
  siteUrl,
} from '../lib/metadata'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: defaultTitle,
    template: '%s | Drapeon',
  },
  description: defaultDescription,
  applicationName: 'Drapeon',
  manifest: '/manifest.webmanifest',
  alternates: {
    canonical: '/',
  },
  category: 'fashion marketplace',
  creator: 'Drapeon',
  publisher: 'O4 Group LLC',
  openGraph: {
    title: defaultTitle,
    description: defaultDescription,
    url: siteUrl,
    siteName: 'Drapeon',
    type: 'website',
    locale: 'en_US',
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: 'Drapeon',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@Drapeonn',
    creator: '@Drapeonn',
    title: defaultTitle,
    description: defaultDescription,
    images: ['/opengraph-image'],
  },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    shortcut: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  verification: process.env.GOOGLE_SITE_VERIFICATION
    ? { google: process.env.GOOGLE_SITE_VERIFICATION }
    : undefined,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body className="bg-ui-canvas text-ink antialiased">
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <Script src="/api/public-env.js" strategy="beforeInteractive" />
        <WebAnalytics />
        <WebSessionScopeGuard />
        <WebCapsLockSignal />
        <AuthLandingRedirect />
        <BrandEntrance />
        <UiProvider>
          <div id="main-content" tabIndex={-1}>
            {children}
          </div>
        </UiProvider>
      </body>
    </html>
  )
}

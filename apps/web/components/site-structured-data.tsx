import { CONTACTS } from '@drape/shared'
import {
  defaultDescription,
  publicPhoneE164,
  siteUrl,
  socialUrls,
} from '../lib/metadata'

const logoUrl = `${siteUrl}/icon-512.png`

const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': `${siteUrl}/#organization`,
  name: 'Drapeon',
  alternateName: 'DrapeOn',
  legalName: 'O4 Group LLC',
  url: siteUrl,
  description: defaultDescription,
  logo: logoUrl,
  image: logoUrl,
  email: CONTACTS.hello,
  telephone: publicPhoneE164,
  contactPoint: [
    {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: CONTACTS.support,
      telephone: publicPhoneE164,
      availableLanguage: ['en'],
    },
    {
      '@type': 'ContactPoint',
      contactType: 'general inquiries',
      email: CONTACTS.hello,
      telephone: publicPhoneE164,
      availableLanguage: ['en'],
    },
  ],
  sameAs: socialUrls,
  brand: {
    '@type': 'Brand',
    name: 'Drapeon',
    logo: logoUrl,
  },
}

const websiteJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': `${siteUrl}/#website`,
  name: 'Drapeon',
  alternateName: 'DrapeOn',
  url: siteUrl,
  description: defaultDescription,
  publisher: {
    '@id': `${siteUrl}/#organization`,
  },
  inLanguage: 'en-US',
  sameAs: socialUrls,
}

function serialize(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

export function SiteStructuredData(): React.JSX.Element {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serialize(organizationJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serialize(websiteJsonLd) }}
      />
    </>
  )
}

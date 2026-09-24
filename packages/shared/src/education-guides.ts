/**
 * Shared starter-guide contract for the public website and native account surfaces.
 *
 * Guides explain a workflow; they do not grant access or infer a conversion. The
 * destination route belongs to the product surface, while progress/analytics are
 * recorded separately through the lifecycle event registry.
 */

export const EDUCATION_GUIDE_ROLES = ['CUSTOMER', 'TAILOR'] as const
export type EducationGuideRole = (typeof EDUCATION_GUIDE_ROLES)[number]

export type EducationGuideStep = {
  id: string
  title: string
  body: string
  webPath: string
  appPath: string
}

export type EducationGuide = {
  id: string
  version: number
  role: EducationGuideRole
  title: string
  summary: string
  steps: readonly EducationGuideStep[]
}

const CUSTOMER_STARTER_GUIDE: EducationGuide = {
  id: 'customer-start-here',
  version: 1,
  role: 'CUSTOMER',
  title: 'Start as a Drapeon customer',
  summary: 'A short path from discovering a tailor to receiving work you understand.',
  steps: [
    {
      id: 'discover',
      title: 'Discover the right tailor',
      body: 'Compare work, services, location, and availability before you start a conversation.',
      webPath: '/explore',
      appPath: 'drape://explore',
    },
    {
      id: 'fit-profile',
      title: 'Save your fit context',
      body: 'Use a fit profile and measurements you can review and reuse across eligible orders.',
      webPath: '/account/measurements',
      appPath: 'drape://profile/measurements',
    },
    {
      id: 'order-thread',
      title: 'Keep the order legible',
      body: 'Brief, quote, payment, production, handoff, and support stay together in one order thread.',
      webPath: '/how-it-works',
      appPath: 'drape://orders',
    },
  ],
}

const TAILOR_STARTER_GUIDE: EducationGuide = {
  id: 'tailor-start-here',
  version: 1,
  role: 'TAILOR',
  title: 'Start as a Drapeon tailor',
  summary: 'A short path from profile setup to a clear, accountable customer relationship.',
  steps: [
    {
      id: 'profile-ready',
      title: 'Make your profile ready',
      body: 'Add your location, specialties, services, and approved portfolio media before discovery.',
      webPath: '/account/profile?setup=1',
      appPath: 'drape://profile/setup',
    },
    {
      id: 'ready-made',
      title: 'Offer custom or ready-made work',
      body: 'Make the order type, fit guidance, availability, and fulfillment promise clear before a customer pays.',
      webPath: '/tailors',
      appPath: 'drape://shop',
    },
    {
      id: 'payouts',
      title: 'Understand the handoff and payout',
      body: 'Keep communication in the order thread and use the payout guide to understand eligibility and release.',
      webPath: '/payouts',
      appPath: 'drape://earnings',
    },
  ],
}

export const EDUCATION_GUIDES: readonly EducationGuide[] = [
  CUSTOMER_STARTER_GUIDE,
  TAILOR_STARTER_GUIDE,
]

export function getEducationGuide(role: EducationGuideRole): EducationGuide {
  return role === 'CUSTOMER' ? CUSTOMER_STARTER_GUIDE : TAILOR_STARTER_GUIDE
}

export function getEducationGuideStep(
  role: EducationGuideRole,
  stepId: string,
): EducationGuideStep | null {
  return getEducationGuide(role).steps.find((step) => step.id === stepId) ?? null
}

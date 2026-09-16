/**
 * Role-specific welcome sequence contract.
 *
 * This is copy and routing only. Delivery, consent, retries, and terminal
 * provider outcomes belong to the communications control plane.
 */

export const WELCOME_ROLES = ['CUSTOMER', 'TAILOR'] as const
export type WelcomeRole = (typeof WELCOME_ROLES)[number]

export const WELCOME_STEPS = ['WELCOME', 'NEXT_STEP'] as const
export type WelcomeStep = (typeof WELCOME_STEPS)[number]

export type WelcomeMessage = {
  role: WelcomeRole
  step: WelcomeStep
  templateKey: string
  subject: string
  eyebrow: string
  headline: string
  body: string
  ctaLabel: string
  webPath: string
  appUrl: string
  delayHours: number
  category: 'ACCOUNT'
  purpose: 'TRANSACTIONAL'
}

const CUSTOMER_SEQUENCE: readonly WelcomeMessage[] = [
  {
    role: 'CUSTOMER',
    step: 'WELCOME',
    templateKey: 'WELCOME_CUSTOMER_V1',
    subject: 'Welcome to Drapeon',
    eyebrow: 'Welcome to Drapeon',
    headline: 'Find work worth wearing.',
    body: 'Discover trusted tailors, keep the conversation together, and move from idea to garment with a clear record of every step.',
    ctaLabel: 'Explore Drapeon',
    webPath: '/explore',
    appUrl: 'drape://',
    delayHours: 0,
    category: 'ACCOUNT',
    purpose: 'TRANSACTIONAL',
  },
  {
    role: 'CUSTOMER',
    step: 'NEXT_STEP',
    templateKey: 'WELCOME_CUSTOMER_NEXT_STEP_V1',
    subject: 'Make your fit yours',
    eyebrow: 'Your next step',
    headline: 'A better fit starts with your profile.',
    body: 'Save the fit details and preferences you want to reuse, then return to the tailors and pieces that feel right for you.',
    ctaLabel: 'Complete your fit profile',
    webPath: '/account/measurements',
    appUrl: 'drape://profile/measurements',
    delayHours: 48,
    category: 'ACCOUNT',
    purpose: 'TRANSACTIONAL',
  },
] as const

const TAILOR_SEQUENCE: readonly WelcomeMessage[] = [
  {
    role: 'TAILOR',
    step: 'WELCOME',
    templateKey: 'WELCOME_TAILOR_V1',
    subject: 'Welcome to Drapeon, tailor',
    eyebrow: 'Welcome to Drapeon',
    headline: 'Let your work find its people.',
    body: 'Build a clear profile, show the work you are proud of, and keep customer conversations, orders, and earnings together.',
    ctaLabel: 'Open your tailor profile',
    webPath: '/account/profile?setup=1',
    appUrl: 'drape://profile/setup',
    delayHours: 0,
    category: 'ACCOUNT',
    purpose: 'TRANSACTIONAL',
  },
  {
    role: 'TAILOR',
    step: 'NEXT_STEP',
    templateKey: 'WELCOME_TAILOR_NEXT_STEP_V1',
    subject: 'Make your Drapeon profile ready',
    eyebrow: 'Your next step',
    headline: 'Show the craft behind the name.',
    body: 'Add approved portfolio media, your services, and at least one ready-made piece when you are ready to be discovered.',
    ctaLabel: 'Continue tailor setup',
    webPath: '/account/profile?setup=1',
    appUrl: 'drape://profile/setup',
    delayHours: 48,
    category: 'ACCOUNT',
    purpose: 'TRANSACTIONAL',
  },
] as const

const WELCOME_SEQUENCES: Record<WelcomeRole, readonly WelcomeMessage[]> = {
  CUSTOMER: CUSTOMER_SEQUENCE,
  TAILOR: TAILOR_SEQUENCE,
}

export function getWelcomeSequence(role: WelcomeRole): readonly WelcomeMessage[] {
  return WELCOME_SEQUENCES[role]
}

export function getWelcomeMessage(role: WelcomeRole, step: WelcomeStep): WelcomeMessage | null {
  return getWelcomeSequence(role).find((message) => message.step === step) ?? null
}

export function welcomeIdempotencyKey(
  userId: string,
  role: WelcomeRole,
  step: WelcomeStep
): string {
  const normalizedUserId = userId.trim()
  if (!normalizedUserId) throw new Error('userId is required for welcome idempotency')
  return `welcome:${role.toLowerCase()}:${normalizedUserId}:${step.toLowerCase()}`
}

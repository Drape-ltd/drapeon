/**
 * Plain-language answers to the questions tailors ask during onboarding.
 *
 * Each entry answers three things in order: what this is, why Drapeon asks, and
 * who can see it. Anything longer than three sentences belongs in a help
 * article linked from the disclosure instead.
 */
export const ONBOARDING_FIELD_HELP = {
  phone:
    'Used for order updates, account recovery, and secure recording links. It is never shown on your public profile and never given to customers.',
  profilePhoto:
    'A clear photo of you or your shopfront. Customers see this on your profile, in messages, and on every order. It is reviewed before your profile goes live.',
  displayName:
    'The name customers see on your profile and in messages. Your studio name or your own name both work.',
  location:
    'The city or area you work from. Shown publicly so customers can find tailors near them. Your street address is never shown here.',
  bio: 'Customers read this before they choose you. What you make best, who you sew for, and how fittings and timelines work. At least 80 characters.',
  languages:
    'Which languages you can hold a fitting conversation in. Shown on your public profile so customers know they can talk to you.',
  specialties:
    'The garments you want to be found for. These drive search and browse, so choose what you actually want to be booked for.',
  businessType:
    'Tailor makes to order. Boutique sells ready-made pieces. Tailor shop does both. This decides what proof you need and what customers can buy.',
  currency: 'The currency your prices are shown and paid in.',
  priceRange:
    'The usual low and high price of a full project in your currency. A guide, not a quote, so customers arrive with the right expectations.',
  orderModes:
    'Custom means you make to their measurements. Ready-made means they buy an existing piece. You can offer both.',
  fulfillment:
    'Pickup from you, local delivery, or shipping. Choose every option you actually offer.',
  pickupAddress:
    'Only shared with a customer who has a confirmed order needing collection. Never shown publicly.',
  consultations:
    'A call before ordering. Free builds trust; paid protects your time. You can credit a paid fee toward the order.',
  portfolio:
    'Real photos of work you made. This is the single biggest factor in whether a customer contacts you. At least one is required to go live.',
  readyMadeItem:
    'One real listing with price, size and stock, so customers can see what buying from you looks like.',
  trustVideo:
    'A short private video where you say a phrase we generate. It proves a real person runs this studio. Only the Drapeon Trust team sees it, it is never public, and we never ask for a government ID.',
  availability:
    'Open, limited, or fully booked. Shown on your profile and you can change it at any time.',
} as const

export type OnboardingHelpKey = keyof typeof ONBOARDING_FIELD_HELP

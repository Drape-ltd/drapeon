/**
 * Harness state catalogue. Kept out of the client component so the server route
 * can validate `?state=` without crossing the client boundary.
 */
export const SIGNUP_PREVIEW_STATES = [
  { id: 'step1-empty', label: 'Step 1 · empty' },
  { id: 'step1-errors', label: 'Step 1 · field errors' },
  { id: 'step1-help-open', label: 'Step 1 · help disclosures open' },
  { id: 'phone-missing', label: 'Phone · none set (OAuth)' },
  { id: 'phone-editing', label: 'Phone · editing' },
  { id: 'phone-code-sent', label: 'Phone · code sent' },
  { id: 'phone-code-wrong', label: 'Phone · wrong code' },
  { id: 'phone-password', label: 'Phone · password path' },
  { id: 'phone-saved', label: 'Phone · confirmed' },
  { id: 'portfolio-empty', label: 'Portfolio · empty' },
  { id: 'portfolio-uploading', label: 'Portfolio · uploading' },
  { id: 'portfolio-mixed', label: 'Portfolio · mixed states' },
  { id: 'portfolio-failed', label: 'Portfolio · upload failed' },
  { id: 'portfolio-at-cap', label: 'Portfolio · item cap reached' },
  { id: 'whats-left', label: 'What’s left · outstanding items' },
  { id: 'whats-left-clear', label: 'What’s left · all clear' },
  { id: 'trust-blocked', label: 'Trust video · blocked' },
] as const

export type SignupPreviewStateId = (typeof SIGNUP_PREVIEW_STATES)[number]['id']

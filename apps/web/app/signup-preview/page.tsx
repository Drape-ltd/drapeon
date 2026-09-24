import { notFound } from 'next/navigation'
import { SignupPreviewHarness } from '../../features/account/tailor-onboarding/preview-harness'
import { SIGNUP_PREVIEW_STATES } from '../../features/account/tailor-onboarding/preview-states'

export const metadata = {
  title: 'Signup preview | Drapeon',
  robots: { index: false, follow: false },
}

export default async function SignupPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>
}): Promise<React.JSX.Element> {
  if (process.env.NODE_ENV !== 'development') notFound()
  const { state } = await searchParams
  const requested = SIGNUP_PREVIEW_STATES.some((entry) => entry.id === state) ? state : undefined
  return <SignupPreviewHarness stateId={requested} />
}

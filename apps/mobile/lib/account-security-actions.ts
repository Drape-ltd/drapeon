import { isLikelyConnectivityIssue, readFunctionErrorMessage } from './function-errors'
import { invokeFunction, supabase } from './supabase'

export async function changePasswordWithReauthProof(input: {
  reauthProof: string
  newPassword: string
}): Promise<{
  error: string | null
  emailQueued?: boolean
}> {
  const { data, error } = await invokeFunction<{ ok?: boolean; emailQueued?: boolean }>(
    'account-security-action',
    {
      body: {
        action: 'change-password',
        reauthProof: input.reauthProof,
        newPassword: input.newPassword,
      },
    }
  )

  if (error) {
    return {
      error: isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not update your password yet.'
        : await readFunctionErrorMessage(error, 'We could not update your password right now.'),
    }
  }

  if (!data?.ok) {
    return { error: 'We could not update your password right now.' }
  }

  // Refresh the identity/provider claims immediately. Without this, a social-only
  // account can keep rendering “Create password” until the next full sign-in.
  await supabase.auth.refreshSession().catch(() => undefined)

  return {
    error: null,
    emailQueued: data.emailQueued === true,
  }
}

export async function startEmailChangeWithReauthProof(input: {
  reauthProof: string
  newEmail: string
}): Promise<{
  error: string | null
  currentEmailQueued?: boolean
  newEmailQueued?: boolean
}> {
  const { data, error } = await invokeFunction<{
    ok?: boolean
    currentEmailQueued?: boolean
    newEmailQueued?: boolean
  }>('account-security-action', {
    body: {
      action: 'start-email-change',
      reauthProof: input.reauthProof,
      newEmail: input.newEmail,
    },
  })

  if (error) {
    return {
      error: isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not start the email change yet.'
        : await readFunctionErrorMessage(error, 'We could not start the email change right now.'),
    }
  }

  if (!data?.ok) {
    return { error: 'We could not start the email change right now.' }
  }

  return {
    error: null,
    currentEmailQueued: data.currentEmailQueued === true,
    newEmailQueued: data.newEmailQueued === true,
  }
}

export async function restoreLocalMfaSession(auth, tokens) {
  if (!tokens.refreshToken) return { session: null, refreshed: false }

  if (tokens.accessToken) {
    const current = await auth.setSession({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    })
    if (!current.error && current.data?.session) {
      return { session: current.data.session, refreshed: false }
    }
  }

  const refreshed = await auth.refreshSession({ refresh_token: tokens.refreshToken })
  if (refreshed.error || !refreshed.data?.session) {
    return { session: null, refreshed: false }
  }
  return { session: refreshed.data.session, refreshed: true }
}

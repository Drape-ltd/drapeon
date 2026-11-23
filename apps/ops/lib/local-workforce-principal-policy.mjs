export function canResolveLocalWorkforcePrincipal({ nodeEnv, mode, email }) {
  return nodeEnv !== 'production'
    && (mode === 'local-workforce' || mode === 'local-supabase-mfa')
    && Boolean(email)
}

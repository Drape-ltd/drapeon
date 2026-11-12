export const DEV_SUPABASE_PROJECT_REF = 'pqptfuqogvrajozfsqzi'
export const PROD_SUPABASE_PROJECT_REF = 'wkfsrunetmgjdtcurmoj'

export function supabaseProjectRef(value) {
  const url = value?.trim()
  if (!url) return null
  if (url === 'https://auth.drapeon.co') return PROD_SUPABASE_PROJECT_REF
  return url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/u)?.[1] ?? null
}

export function localSupabaseMfaGate(env) {
  const urlRef = supabaseProjectRef(env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL)
  const expectedRef = env.DRAPE_EXPECTED_SUPABASE_PROJECT_REF?.trim() ?? null
  const nonProduction = env.NODE_ENV !== 'production' && env.DRAPE_OPS_ENV !== 'production' && env.DRAPE_WEB_ENV !== 'production'
  const allowed = env.OPS_LOCAL_SUPABASE_MFA === '1'
    && nonProduction
    && urlRef === DEV_SUPABASE_PROJECT_REF
    && expectedRef === DEV_SUPABASE_PROJECT_REF

  return { allowed, urlRef, expectedRef, nonProduction }
}

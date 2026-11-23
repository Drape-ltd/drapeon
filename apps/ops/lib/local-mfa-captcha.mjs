export function requiredCaptchaToken(form) {
  const token = String(form.get('captchaToken') ?? '').trim()
  return token || null
}

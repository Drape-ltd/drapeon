import type { ErrorEvent } from '@sentry/core'

const sensitiveValue = /\b(access_token|refresh_token|token|code|authorization|password)=([^&\s]+)/giu
const bearerValue = /\bBearer\s+[^\s]+/giu
const emailValue = /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/giu

function scrubText(value: string) {
  return value
    .replace(sensitiveValue, '$1=[Filtered]')
    .replace(bearerValue, 'Bearer [Filtered]')
    .replace(emailValue, '[email]')
    .slice(0, 500)
}

function pathOnly(value: string) {
  try {
    return new URL(value).pathname
  } catch {
    return value.split(/[?#]/u, 1)[0]?.slice(0, 240) ?? ''
  }
}

export function scrubSentryEvent(event: ErrorEvent): ErrorEvent {
  delete event.user

  if (event.request) {
    if (event.request.url) event.request.url = pathOnly(event.request.url)
    delete event.request.headers
    delete event.request.cookies
    delete event.request.data
    delete event.request.query_string
  }

  if (event.message) event.message = scrubText(event.message)
  if (event.transaction) event.transaction = pathOnly(event.transaction)

  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubText(exception.value)
  }

  return event
}

export function webSentryOptions() {
  return {
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.DRAPE_WEB_ENV || 'production',
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: scrubSentryEvent,
  }
}

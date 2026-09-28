import { formatExplicitZonedDateTime } from '@drape/shared/date-time'

export function defaultConsultationStart() {
  const value = new Date()
  value.setDate(value.getDate() + 1)
  value.setMinutes(0, 0, 0)
  return value
}

export function formatConsultationStart(value: string | Date | null | undefined, timezone?: string | null) {
  return formatExplicitZonedDateTime(value, { timeZone: timezone, fallback: 'Choose a time' }) ?? 'Choose a time'
}

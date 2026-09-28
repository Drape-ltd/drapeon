import type { ScopeChangeType } from '@/lib/order-support'

export function customerCommercialAdjustmentTypeForScope(type: ScopeChangeType) {
  if (type === 'MEASUREMENT_AMENDMENT') return 'FIT_REVISION' as const
  if (type === 'FABRIC_OR_MATERIAL') return 'MATERIAL' as const
  if (type === 'DEADLINE_OR_EVENT') return 'RUSH_WORK' as const
  if (type === 'PAUSE_OR_RESTART') return 'DEADLINE_EXTENSION' as const
  if (type === 'REWORK_OR_ALTERATION') return 'CORRECTION' as const
  return 'SCOPE' as const
}

export type AftercareSupportType =
  | 'FIT_ISSUE'
  | 'FINISH_ISSUE'
  | 'DAMAGE_OR_DEFECT'
  | 'ALTERATION_FOLLOW_UP'
  | 'OTHER'
export const AFTERCARE_SUPPORT_OPTIONS: AftercareSupportType[] = [
  'FIT_ISSUE',
  'FINISH_ISSUE',
  'DAMAGE_OR_DEFECT',
  'ALTERATION_FOLLOW_UP',
  'OTHER',
]
export const AFTERCARE_SUPPORT_LABELS: Record<AftercareSupportType, string> = {
  FIT_ISSUE: 'Fit issue',
  FINISH_ISSUE: 'Finish issue',
  DAMAGE_OR_DEFECT: 'Damage or defect',
  ALTERATION_FOLLOW_UP: 'Alteration follow-up',
  OTHER: 'Other aftercare issue',
}

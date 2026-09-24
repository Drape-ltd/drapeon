/** Portable seller size-guide editor contract shared by account clients. */
export type ReadyMadeFitUnit = 'in' | 'cm'
export type ReadyMadeFitAdvice =
  | 'SIZE_UP_IF_BETWEEN'
  | 'SIZE_DOWN_IF_BETWEEN'
  | 'ASK_SELLER'
export type ReadyMadeFitFieldKey =
  | 'chest'
  | 'waist'
  | 'hips'
  | 'shoulderWidth'
  | 'inseam'
  | 'sleeveLength'
  | 'neckCircumference'
  | 'underBust'
  | 'height'
  | 'backLength'
  | 'outseam'
  | 'thighCircumference'
  | 'kneeCircumference'
  | 'bicepCircumference'
  | 'wristCircumference'
  | 'headCircumference'
  | 'hatBandLine'
  | 'headLength'
  | 'headWidth'
  | 'earToEarOverCrown'
  | 'frontToBackOverCrown'
  | 'filaHeight'
  | 'torsoLength'

type ReadyMadeFitRange = {
  min: number | null
  max: number | null
}

export type ReadyMadeSizeGuide = {
  version: 1
  unit: ReadyMadeFitUnit
  fields: ReadyMadeFitFieldKey[]
  sizeRanges: Record<string, Partial<Record<ReadyMadeFitFieldKey, ReadyMadeFitRange>>>
  fitNotes: string | null
  stretchNotes: string | null
  sizeAdvice: ReadyMadeFitAdvice | null
}

export type ReadyMadeSizeGuideDraft = Record<
  string,
  Partial<Record<ReadyMadeFitFieldKey, { min: string; max: string }>>
>

export const READY_MADE_FIT_FIELDS: Array<{
  key: ReadyMadeFitFieldKey
  label: string
  shortLabel: string
}> = [
  { key: 'chest', label: 'Chest', shortLabel: 'Chest' },
  { key: 'waist', label: 'Waist', shortLabel: 'Waist' },
  { key: 'hips', label: 'Hips', shortLabel: 'Hips' },
  { key: 'shoulderWidth', label: 'Shoulders', shortLabel: 'Shoulders' },
  { key: 'inseam', label: 'Inseam', shortLabel: 'Inseam' },
  { key: 'sleeveLength', label: 'Sleeve length', shortLabel: 'Sleeve' },
  { key: 'neckCircumference', label: 'Neck', shortLabel: 'Neck' },
  { key: 'underBust', label: 'Under bust', shortLabel: 'Under bust' },
  { key: 'height', label: 'Height', shortLabel: 'Height' },
  { key: 'backLength', label: 'Back length', shortLabel: 'Back' },
  { key: 'outseam', label: 'Outseam', shortLabel: 'Outseam' },
  { key: 'thighCircumference', label: 'Thigh', shortLabel: 'Thigh' },
  { key: 'kneeCircumference', label: 'Knee', shortLabel: 'Knee' },
  { key: 'bicepCircumference', label: 'Bicep', shortLabel: 'Bicep' },
  { key: 'wristCircumference', label: 'Wrist', shortLabel: 'Wrist' },
  { key: 'headCircumference', label: 'Head circumference', shortLabel: 'Head' },
  { key: 'hatBandLine', label: 'Hat band line', shortLabel: 'Hat band' },
  { key: 'headLength', label: 'Head length', shortLabel: 'Head length' },
  { key: 'headWidth', label: 'Head width', shortLabel: 'Head width' },
  { key: 'earToEarOverCrown', label: 'Ear to ear over crown', shortLabel: 'Crown ear-to-ear' },
  {
    key: 'frontToBackOverCrown',
    label: 'Front to back over crown',
    shortLabel: 'Crown front-back',
  },
  { key: 'filaHeight', label: 'Fila height', shortLabel: 'Fila height' },
  { key: 'torsoLength', label: 'Torso length', shortLabel: 'Torso' },
]

export const READY_MADE_SIZE_GUIDE_ADVICE_OPTIONS: Array<{
  value: ReadyMadeFitAdvice
  label: string
  hint: string
}> = [
  {
    value: 'SIZE_UP_IF_BETWEEN',
    label: 'Size up if between',
    hint: 'Good for fitted pieces or fabric with little stretch.',
  },
  {
    value: 'SIZE_DOWN_IF_BETWEEN',
    label: 'Size down if between',
    hint: 'Good for relaxed cuts or stretch fabrics.',
  },
  {
    value: 'ASK_SELLER',
    label: 'Ask seller if between',
    hint: 'Use this when fit depends on styling or cut.',
  },
]

export const FALLBACK_READY_MADE_FIT_FIELDS: ReadyMadeFitFieldKey[] = [
  'chest',
  'waist',
  'hips',
]

const READY_MADE_CATEGORY_FIELD_MAP: Record<string, ReadyMadeFitFieldKey[]> = {
  agbada: ['chest', 'shoulderWidth', 'waist', 'sleeveLength', 'height'],
  kaftan: ['chest', 'shoulderWidth', 'waist', 'sleeveLength', 'height'],
  suit: ['chest', 'waist', 'shoulderWidth', 'sleeveLength', 'inseam', 'outseam'],
  dress: ['chest', 'waist', 'hips', 'height', 'torsoLength'],
  crochet: ['chest', 'waist', 'hips', 'height', 'torsoLength'],
  'ready-made': ['chest', 'waist', 'hips'],
  'two-piece set': ['chest', 'waist', 'hips', 'inseam', 'outseam'],
  trousers: ['waist', 'hips', 'inseam', 'outseam', 'thighCircumference'],
  skirt: ['waist', 'hips', 'height'],
  shirt: ['chest', 'shoulderWidth', 'sleeveLength', 'neckCircumference'],
  'native wear': ['chest', 'shoulderWidth', 'waist', 'sleeveLength', 'height'],
  headwear: ['headCircumference', 'hatBandLine', 'headLength', 'headWidth'],
  hat: ['headCircumference', 'hatBandLine', 'headLength', 'headWidth'],
  cap: ['headCircumference', 'hatBandLine', 'headLength', 'headWidth'],
  fila: [
    'headCircumference',
    'hatBandLine',
    'earToEarOverCrown',
    'frontToBackOverCrown',
    'filaHeight',
  ],
  gele: ['headCircumference', 'hatBandLine'],
}

const READY_MADE_FIT_FIELD_SET = new Set<ReadyMadeFitFieldKey>(
  READY_MADE_FIT_FIELDS.map((field) => field.key)
)

export function readyMadeFitFieldLabel(field: ReadyMadeFitFieldKey) {
  return READY_MADE_FIT_FIELDS.find((entry) => entry.key === field)?.label ?? field
}

export function recommendedReadyMadeFitFieldsForCategory(
  category: string | null | undefined
) {
  const normalized = category?.trim().toLowerCase() ?? ''
  return READY_MADE_CATEGORY_FIELD_MAP[normalized] ?? FALLBACK_READY_MADE_FIT_FIELDS
}

function asPositiveFitNumber(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return Number(value.toFixed(2))
}

function normalizeReadyMadeFitFields(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (field): field is ReadyMadeFitFieldKey =>
        typeof field === 'string' && READY_MADE_FIT_FIELD_SET.has(field as ReadyMadeFitFieldKey)
    )
    .filter((field, index, all) => all.indexOf(field) === index)
}

function normalizeReadyMadeFitRange(raw: unknown): ReadyMadeFitRange | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  let min = asPositiveFitNumber((raw as Record<string, unknown>).min)
  let max = asPositiveFitNumber((raw as Record<string, unknown>).max)
  if (min == null && max == null) return null
  if (min != null && max != null && max < min) [min, max] = [max, min]
  return { min, max }
}

export function emptyReadyMadeSizeGuide(unit: ReadyMadeFitUnit = 'in'): ReadyMadeSizeGuide {
  return {
    version: 1,
    unit,
    fields: [],
    sizeRanges: {},
    fitNotes: null,
    stretchNotes: null,
    sizeAdvice: 'ASK_SELLER',
  }
}

export function normalizeWebReadyMadeSizeGuide(
  raw: unknown,
  sizes: string[]
): ReadyMadeSizeGuide {
  const base = emptyReadyMadeSizeGuide()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base
  const value = raw as Record<string, unknown>
  const fields = normalizeReadyMadeFitFields(value.fields)
  const sizeRanges: ReadyMadeSizeGuide['sizeRanges'] = {}
  for (const size of sizes) {
    const rawSizeRanges =
      value.sizeRanges && typeof value.sizeRanges === 'object' && !Array.isArray(value.sizeRanges)
        ? (value.sizeRanges as Record<string, unknown>)[size]
        : null
    if (!rawSizeRanges || typeof rawSizeRanges !== 'object' || Array.isArray(rawSizeRanges))
      continue
    const nextRanges: Partial<Record<ReadyMadeFitFieldKey, ReadyMadeFitRange>> = {}
    for (const field of fields) {
      const range = normalizeReadyMadeFitRange((rawSizeRanges as Record<string, unknown>)[field])
      if (range) nextRanges[field] = range
    }
    if (Object.keys(nextRanges).length > 0) sizeRanges[size] = nextRanges
  }
  const sizeAdvice =
    value.sizeAdvice === 'SIZE_UP_IF_BETWEEN' ||
    value.sizeAdvice === 'SIZE_DOWN_IF_BETWEEN' ||
    value.sizeAdvice === 'ASK_SELLER'
      ? value.sizeAdvice
      : 'ASK_SELLER'
  return {
    version: 1,
    unit: value.unit === 'cm' ? 'cm' : 'in',
    fields,
    sizeRanges,
    fitNotes:
      typeof value.fitNotes === 'string' && value.fitNotes.trim().length > 0
        ? value.fitNotes.trim()
        : null,
    stretchNotes:
      typeof value.stretchNotes === 'string' && value.stretchNotes.trim().length > 0
        ? value.stretchNotes.trim()
        : null,
    sizeAdvice,
  }
}

export function guideDraftFromWebReadyMadeSizeGuide(input: {
  sizes: string[]
  fields: ReadyMadeFitFieldKey[]
  guide: ReadyMadeSizeGuide | null | undefined
}): ReadyMadeSizeGuideDraft {
  const normalizedGuide = input.guide ?? emptyReadyMadeSizeGuide()
  const nextDraft: ReadyMadeSizeGuideDraft = {}
  for (const size of input.sizes) {
    nextDraft[size] = {}
    for (const field of input.fields) {
      const range = normalizedGuide.sizeRanges[size]?.[field]
      nextDraft[size][field] = {
        min: range?.min != null ? String(range.min) : '',
        max: range?.max != null ? String(range.max) : '',
      }
    }
  }
  return nextDraft
}

export function draftToWebReadyMadeSizeGuide(input: {
  sizes: string[]
  unit: ReadyMadeFitUnit
  fields: ReadyMadeFitFieldKey[]
  draft: ReadyMadeSizeGuideDraft
  fitNotes: string
  stretchNotes: string
  sizeAdvice: ReadyMadeFitAdvice | null
}): ReadyMadeSizeGuide {
  const fields = normalizeReadyMadeFitFields(input.fields)
  const sizeRanges: ReadyMadeSizeGuide['sizeRanges'] = {}
  for (const size of input.sizes) {
    const nextRanges: Partial<Record<ReadyMadeFitFieldKey, ReadyMadeFitRange>> = {}
    for (const field of fields) {
      const rangeDraft = input.draft[size]?.[field]
      const range = normalizeReadyMadeFitRange({
        min:
          typeof rangeDraft?.min === 'string' && rangeDraft.min.trim().length > 0
            ? Number(rangeDraft.min)
            : null,
        max:
          typeof rangeDraft?.max === 'string' && rangeDraft.max.trim().length > 0
            ? Number(rangeDraft.max)
            : null,
      })
      if (range) nextRanges[field] = range
    }
    if (Object.keys(nextRanges).length > 0) sizeRanges[size] = nextRanges
  }
  return {
    version: 1,
    unit: input.unit,
    fields,
    sizeRanges,
    fitNotes: input.fitNotes.trim().slice(0, 240) || null,
    stretchNotes: input.stretchNotes.trim().slice(0, 240) || null,
    sizeAdvice: input.sizeAdvice ?? 'ASK_SELLER',
  }
}

export function hasReadyMadeSizeGuide(
  guide: ReadyMadeSizeGuide | null | undefined,
  sizes?: string[]
) {
  if (!guide) return false
  const relevantSizes = sizes?.length ? sizes : Object.keys(guide.sizeRanges)
  if (guide.fields.length === 0 || relevantSizes.length === 0) return false
  return relevantSizes.some((size) =>
    guide.fields.some((field) => {
      const range = guide.sizeRanges[size]?.[field]
      return Boolean(range && (range.min != null || range.max != null))
    })
  )
}

export function fitGuideInputValue(value: string) {
  const normalized = value.replace(/,/g, '.').replace(/[^\d.]/g, '')
  const [whole = '', ...rest] = normalized.split('.')
  return rest.length > 0 ? `${whole}.${rest.join('')}` : whole
}

export function fitGuideFieldsSummary(fields: ReadyMadeFitFieldKey[]) {
  if (fields.length === 0) return 'Choose fields'
  const labels = fields.slice(0, 3).map((field) => readyMadeFitFieldLabel(field))
  return fields.length > 3 ? `${labels.join(', ')} +${fields.length - 3}` : labels.join(', ')
}

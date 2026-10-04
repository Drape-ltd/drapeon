/** Private fitting-record CSV. No passport bearer links or contact details. */
export type DiaryExportRow = {
  full_name: string | null
  gender?: string | null
  measurement_unit?: string | null
  chest?: number | null
  shoulder?: number | null
  sleeve?: number | null
  waist?: number | null
  hip?: number | null
  neck?: number | null
  trouser_length?: number | null
  thigh?: number | null
  inseam?: number | null
  ankle?: number | null
  bicep?: number | null
  wrist?: number | null
  back_length?: number | null
  under_bust?: number | null
  fabric_preference?: string | null
  style_preference?: string | null
  event_type?: string | null
  client_notes?: string | null
  special_fitting_notes?: string | null
  measured_at?: string | null
  measured_location?: string | null
  invite_status?: string | null
}

const columns: Array<[string, keyof DiaryExportRow]> = [
  ['Client name', 'full_name'], ['Gender', 'gender'], ['Unit', 'measurement_unit'],
  ['Chest', 'chest'], ['Shoulder', 'shoulder'], ['Sleeve', 'sleeve'],
  ['Waist', 'waist'], ['Hip', 'hip'], ['Neck', 'neck'],
  ['Trouser length', 'trouser_length'], ['Thigh', 'thigh'], ['Inseam', 'inseam'],
  ['Ankle', 'ankle'], ['Bicep', 'bicep'], ['Wrist', 'wrist'],
  ['Back length', 'back_length'], ['Under bust', 'under_bust'],
  ['Fabric preference', 'fabric_preference'], ['Style preference', 'style_preference'],
  ['Event type', 'event_type'], ['Client notes', 'client_notes'],
  ['Fitting notes', 'special_fitting_notes'], ['Measured at', 'measured_at'],
  ['Measured location', 'measured_location'], ['Invite status', 'invite_status'],
]

function cell(value: string | number | null | undefined): string {
  const raw = value == null ? '' : String(value)
  // Quoting alone does not stop spreadsheet formula execution. Neutralize
  // formula-leading text, including whitespace/control-character prefixes.
  const safe = typeof value === 'string' && /^[\s\u0000-\u001f]*[=+\-@]/u.test(raw) ? `'${raw}` : raw
  return `"${safe.replace(/"/g, '""')}"`
}

export function buildDiaryCsv(rows: DiaryExportRow[]): string {
  return '\uFEFF' + [
    columns.map(([title]) => cell(title)).join(','),
    ...rows.map((row) => columns.map(([, key]) => cell(row[key])).join(',')),
  ].join('\r\n') + '\r\n'
}

import { buildDiaryCsv } from '../src/diary-export'

describe('private diary CSV export', () => {
  it('exports measurements and notes without passport IDs or contact fields', () => {
    const csv = buildDiaryCsv([{ full_name: 'Ada, Jr.', chest: 92, client_notes: 'Blue "lace"' }])
    expect(csv).toContain('"Ada, Jr."')
    expect(csv).toContain('"92"')
    expect(csv).toContain('"Blue ""lace"""')
    expect(csv).not.toContain('passport_id')
    expect(csv).not.toContain('phone')
  })

  it('can export one selected record without including another client', () => {
    const csv = buildDiaryCsv([{ full_name: 'Amara Bello', chest: 90 }])
    expect(csv).toContain('"Amara Bello"')
    expect(csv).not.toContain('Bola Nwosu')
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(2)
  })

  it.each(['=1+1', ' +SUM(A1:A2)', '@SUM(A1)', '-1+2', '\t=2+2'])('neutralizes spreadsheet formula %s', (value) => {
    expect(buildDiaryCsv([{ full_name: value }])).toContain(`"'${value}"`)
  })
})

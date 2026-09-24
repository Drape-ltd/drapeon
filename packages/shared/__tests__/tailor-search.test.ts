import { parseTailorSearchQuery } from '../src/tailor-search'

describe('parseTailorSearchQuery', () => {
  it('splits specialty and location', () => {
    expect(parseTailorSearchQuery('Suits in Lagos')).toEqual({
      specialty: 'Suits',
      location: 'Lagos',
      general: '',
    })
  })

  it('supports location-only tailor phrasing', () => {
    expect(parseTailorSearchQuery('tailors in London')).toEqual({
      specialty: '',
      location: 'london',
      general: '',
    })
  })

  it('keeps plain terms as general search', () => {
    expect(parseTailorSearchQuery('Ankara')).toEqual({
      specialty: '',
      location: '',
      general: 'Ankara',
    })
  })
})

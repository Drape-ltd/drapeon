import {
  draftToWebReadyMadeSizeGuide,
  fitGuideFieldsSummary,
  fitGuideInputValue,
  guideDraftFromWebReadyMadeSizeGuide,
  hasReadyMadeSizeGuide,
  normalizeWebReadyMadeSizeGuide,
  recommendedReadyMadeFitFieldsForCategory,
} from '../src/ready-made-size-guide-editor'

describe('web ready-made size guide', () => {
  it('normalizes fields, ranges, notes, and reversed bounds', () => {
    expect(
      normalizeWebReadyMadeSizeGuide(
        {
          unit: 'cm',
          fields: ['chest', 'waist', 'chest', 'unsafe'],
          sizeRanges: {
            M: {
              chest: { min: 102, max: 96 },
              waist: { min: 0, max: 84.456 },
            },
          },
          fitNotes: '  Close fit  ',
          stretchNotes: '  Low stretch  ',
          sizeAdvice: 'SIZE_UP_IF_BETWEEN',
        },
        ['M']
      )
    ).toEqual({
      version: 1,
      unit: 'cm',
      fields: ['chest', 'waist'],
      sizeRanges: {
        M: {
          chest: { min: 96, max: 102 },
          waist: { min: null, max: 84.46 },
        },
      },
      fitNotes: 'Close fit',
      stretchNotes: 'Low stretch',
      sizeAdvice: 'SIZE_UP_IF_BETWEEN',
    })
  })

  it('round-trips editable drafts without inventing empty ranges', () => {
    const guide = draftToWebReadyMadeSizeGuide({
      sizes: ['S', 'M'],
      unit: 'in',
      fields: ['chest', 'waist'],
      draft: {
        S: { chest: { min: '32', max: '35' }, waist: { min: '', max: '' } },
        M: { chest: { min: '36', max: '39' } },
      },
      fitNotes: ' fitted ',
      stretchNotes: '',
      sizeAdvice: 'ASK_SELLER',
    })

    expect(hasReadyMadeSizeGuide(guide, ['S', 'M'])).toBe(true)
    expect(
      guideDraftFromWebReadyMadeSizeGuide({
        sizes: ['S', 'M'],
        fields: ['chest', 'waist'],
        guide,
      })
    ).toEqual({
      S: { chest: { min: '32', max: '35' }, waist: { min: '', max: '' } },
      M: { chest: { min: '36', max: '39' }, waist: { min: '', max: '' } },
    })
  })

  it('keeps category recommendations and fallback fields stable', () => {
    expect(recommendedReadyMadeFitFieldsForCategory(' Suit ')).toEqual([
      'chest',
      'waist',
      'shoulderWidth',
      'sleeveLength',
      'inseam',
      'outseam',
    ])
    expect(recommendedReadyMadeFitFieldsForCategory('unknown')).toEqual([
      'chest',
      'waist',
      'hips',
    ])
  })

  it('sanitizes decimal input while preserving one decimal separator', () => {
    expect(fitGuideInputValue(' 32,5 in ')).toBe('32.5')
    expect(fitGuideInputValue('1.2.3')).toBe('1.23')
  })

  it('summarizes selected fields without overflowing control copy', () => {
    expect(fitGuideFieldsSummary([])).toBe('Choose fields')
    expect(fitGuideFieldsSummary(['chest', 'waist', 'hips', 'height'])).toBe(
      'Chest, Waist, Hips +1'
    )
  })
})

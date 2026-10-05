import {
  REFERENCE_PHOTO_MAX_ATTRIBUTES,
  REFERENCE_PHOTO_NOTE_MAX_CHARS,
  countAttributedReferencePhotos,
  isReferencePhotoStyleAttribute,
  referencePhotoAttributionFor,
  sanitizeReferencePhotoAttributions,
  summarizeReferencePhotoAttributions,
} from '../src/reference-photo-attribution'

const PHOTOS = ['orders/a.jpg', 'orders/b.jpg', 'orders/c.jpg']

describe('isReferencePhotoStyleAttribute', () => {
  it('accepts values from the shared style taxonomy', () => {
    expect(isReferencePhotoStyleAttribute('Neckline')).toBe(true)
    expect(isReferencePhotoStyleAttribute('Sleeve')).toBe(true)
  })

  it('rejects anything outside it', () => {
    expect(isReferencePhotoStyleAttribute('Vibes')).toBe(false)
    expect(isReferencePhotoStyleAttribute('neckline')).toBe(false)
    expect(isReferencePhotoStyleAttribute(null)).toBe(false)
  })
})

describe('sanitizeReferencePhotoAttributions', () => {
  it('keeps attributions whose photo is attached to the brief', () => {
    const result = sanitizeReferencePhotoAttributions(
      [{ photo: 'orders/a.jpg', attributes: ['Neckline', 'Sleeve'], note: 'Neckline only' }],
      PHOTOS,
    )
    expect(result).toEqual([
      { photo: 'orders/a.jpg', attributes: ['Sleeve', 'Neckline'], note: 'Neckline only' },
    ])
  })

  it('drops an attribution whose photo was removed from the brief', () => {
    const result = sanitizeReferencePhotoAttributions(
      [{ photo: 'orders/deleted.jpg', attributes: ['Neckline'] }],
      PHOTOS,
    )
    expect(result).toEqual([])
  })

  it('returns nothing when the brief has no reference photos', () => {
    expect(sanitizeReferencePhotoAttributions([{ photo: 'orders/a.jpg', attributes: ['Fit'] }], [])).toEqual([])
    expect(sanitizeReferencePhotoAttributions([{ photo: 'orders/a.jpg', attributes: ['Fit'] }], null)).toEqual([])
  })

  it('emits attributes in taxonomy order regardless of input order', () => {
    const [entry] = sanitizeReferencePhotoAttributions(
      [{ photo: 'orders/a.jpg', attributes: ['Neckline', 'Colour', 'Length'] }],
      PHOTOS,
    )
    expect(entry.attributes).toEqual(['Colour', 'Length', 'Neckline'])
  })

  it('caps attributes per photo and discards unknown ones', () => {
    const [entry] = sanitizeReferencePhotoAttributions(
      [
        {
          photo: 'orders/a.jpg',
          attributes: ['Colour', 'Silhouette', 'Length', 'Sleeve', 'Neckline', 'Closure', 'Nonsense'],
        },
      ],
      PHOTOS,
    )
    expect(entry.attributes).toHaveLength(REFERENCE_PHOTO_MAX_ATTRIBUTES)
    expect(entry.attributes).not.toContain('Nonsense')
  })

  it('deduplicates repeated attributes', () => {
    const [entry] = sanitizeReferencePhotoAttributions(
      [{ photo: 'orders/a.jpg', attributes: ['Fit', 'Fit', 'Fit'] }],
      PHOTOS,
    )
    expect(entry.attributes).toEqual(['Fit'])
  })

  it('keeps only the first attribution for a repeated photo', () => {
    const result = sanitizeReferencePhotoAttributions(
      [
        { photo: 'orders/a.jpg', attributes: ['Neckline'] },
        { photo: 'orders/a.jpg', attributes: ['Pockets'] },
      ],
      PHOTOS,
    )
    expect(result).toHaveLength(1)
    expect(result[0].attributes).toEqual(['Neckline'])
  })

  it('trims, collapses whitespace in, and truncates the note', () => {
    const [entry] = sanitizeReferencePhotoAttributions(
      [{ photo: 'orders/a.jpg', attributes: [], note: `  keep   this  ${'x'.repeat(300)}  ` }],
      PHOTOS,
    )
    expect(entry.note?.startsWith('keep this ')).toBe(true)
    expect(entry.note).toHaveLength(REFERENCE_PHOTO_NOTE_MAX_CHARS)
  })

  it('drops an entry that carries neither an attribute nor a note', () => {
    expect(
      sanitizeReferencePhotoAttributions(
        [
          { photo: 'orders/a.jpg', attributes: [], note: '   ' },
          { photo: 'orders/b.jpg', attributes: ['Fit'] },
        ],
        PHOTOS,
      ),
    ).toEqual([{ photo: 'orders/b.jpg', attributes: ['Fit'] }])
  })

  it('keeps a note-only attribution', () => {
    expect(
      sanitizeReferencePhotoAttributions([{ photo: 'orders/a.jpg', attributes: [], note: 'Just the drape' }], PHOTOS),
    ).toEqual([{ photo: 'orders/a.jpg', attributes: [], note: 'Just the drape' }])
  })

  it('ignores malformed input', () => {
    expect(sanitizeReferencePhotoAttributions(null, PHOTOS)).toEqual([])
    expect(sanitizeReferencePhotoAttributions('nope', PHOTOS)).toEqual([])
    expect(sanitizeReferencePhotoAttributions([null, 7, 'x', { photo: 42 }], PHOTOS)).toEqual([])
  })
})

describe('summarizeReferencePhotoAttributions', () => {
  it('numbers photos by their position in the submitted brief', () => {
    const lines = summarizeReferencePhotoAttributions(
      [
        { photo: 'orders/c.jpg', attributes: ['Pockets'] },
        { photo: 'orders/b.jpg', attributes: ['Neckline', 'Sleeve'], note: 'Longer sleeves' },
      ],
      PHOTOS,
    )
    expect(lines).toEqual([
      'Photo 2 — Neckline, Sleeve — "Longer sleeves"',
      'Photo 3 — Pockets',
    ])
  })

  it('renders a note-only attribution without a dangling separator', () => {
    expect(
      summarizeReferencePhotoAttributions([{ photo: 'orders/a.jpg', attributes: [], note: 'This drape' }], PHOTOS),
    ).toEqual(['Photo 1 — "This drape"'])
  })

  it('returns nothing when there is nothing attributed', () => {
    expect(summarizeReferencePhotoAttributions([], PHOTOS)).toEqual([])
    expect(summarizeReferencePhotoAttributions(null, PHOTOS)).toEqual([])
  })
})

describe('referencePhotoAttributionFor', () => {
  it('finds the attribution for a photo', () => {
    const attributions = [{ photo: 'orders/b.jpg', attributes: ['Fit' as const] }]
    expect(referencePhotoAttributionFor(attributions, 'orders/b.jpg')?.attributes).toEqual(['Fit'])
    expect(referencePhotoAttributionFor(attributions, 'orders/a.jpg')).toBeNull()
    expect(referencePhotoAttributionFor(attributions, null)).toBeNull()
  })
})

describe('countAttributedReferencePhotos', () => {
  it('counts attributed photos', () => {
    expect(countAttributedReferencePhotos([{ photo: 'orders/a.jpg', attributes: ['Fit'] }])).toBe(1)
    expect(countAttributedReferencePhotos(null)).toBe(0)
  })
})

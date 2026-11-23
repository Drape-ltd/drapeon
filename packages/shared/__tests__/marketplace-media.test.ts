import { isDrapeonBrandMarkUrl, marketplaceMediaObjectPosition, normalizeFocalPoint, resolveMarketplaceExploreCover } from '../src/marketplace-media'

describe('marketplace media presentation', () => {
  it('keeps valid normalized focal coordinates', () => {
    expect(normalizeFocalPoint(0.28)).toBe(0.28)
  })

  it('bounds invalid presentation coordinates', () => {
    expect(normalizeFocalPoint(-2)).toBe(0)
    expect(normalizeFocalPoint(3)).toBe(1)
    expect(normalizeFocalPoint(Number.NaN)).toBe(0.5)
  })

  it('creates a CSS object position from canonical media', () => {
    expect(marketplaceMediaObjectPosition({ focalX: 0.25, focalY: 0.7 })).toBe('25% 70%')
  })

  it('prefers the first real portfolio photo over a default Drapeon mark', () => {
    expect(resolveMarketplaceExploreCover({
      portfolioPhotoUrls: [
        'https://cdn.example.test/drapeon-mark.png',
        'https://cdn.example.test/portfolio/look-1.jpg',
      ],
      exploreImageUrl: 'https://cdn.example.test/drapeon-mark.png',
    })).toEqual({
      url: 'https://cdn.example.test/portfolio/look-1.jpg',
      bucket: 'portfolio-photos',
      source: 'portfolio',
    })
    expect(isDrapeonBrandMarkUrl('https://cdn.example.test/drapeon-mark.png?size=320')).toBe(true)
  })

  it('uses a structured portfolio image before a default Drapeon mark', () => {
    expect(resolveMarketplaceExploreCover({
      media: [{
        kind: 'IMAGE',
        url: 'https://cdn.example.test/portfolio/structured-photo.jpg',
        posterUrl: null,
        position: 0,
      }],
      exploreImageUrl: 'https://cdn.example.test/drapeon-mark.png',
    })).toEqual({
      url: 'https://cdn.example.test/portfolio/structured-photo.jpg',
      bucket: 'portfolio-photos',
      source: 'media',
    })
  })

  it('uses an approved portfolio poster before avatar or logo fallbacks', () => {
    expect(resolveMarketplaceExploreCover({
      media: [{
        kind: 'VIDEO',
        url: 'https://cdn.example.test/portfolio/video.mp4',
        posterUrl: 'https://cdn.example.test/portfolio/video-poster.jpg',
        position: 0,
      }],
      exploreImageUrl: 'https://cdn.example.test/drapeon-mark.png',
      avatarUrl: 'https://cdn.example.test/avatar.jpg',
    })).toEqual({
      url: 'https://cdn.example.test/portfolio/video-poster.jpg',
      bucket: 'portfolio-photos',
      source: 'media',
    })
  })

  it('uses the default brand mark only when no real media is available', () => {
    expect(resolveMarketplaceExploreCover({
      exploreImageUrl: 'https://cdn.example.test/drapeon-mark.png',
      avatarUrl: 'https://cdn.example.test/icon-512.png',
    })).toEqual({
      url: 'https://cdn.example.test/drapeon-mark.png',
      bucket: 'portfolio-photos',
      source: 'explore',
    })

    expect(resolveMarketplaceExploreCover({
      media: [{
        kind: 'VIDEO',
        url: 'https://cdn.example.test/portfolio/video.mp4',
        posterUrl: null,
        position: 0,
      }],
      exploreImageUrl: 'https://cdn.example.test/drapeon-mark.png',
    })).toBeNull()
  })
})

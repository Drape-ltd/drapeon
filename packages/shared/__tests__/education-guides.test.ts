import {
  EDUCATION_GUIDES,
  getEducationGuide,
  getEducationGuideStep,
} from '../src/education-guides'

describe('education guide contract', () => {
  it('keeps both role paths ordered and deep-linkable', () => {
    expect(EDUCATION_GUIDES).toHaveLength(2)
    for (const guide of EDUCATION_GUIDES) {
      expect(guide.steps.length).toBeGreaterThanOrEqual(3)
      expect(guide.steps.every((step) => step.webPath && step.appPath)).toBe(true)
    }
    expect(getEducationGuide('CUSTOMER').steps[0].id).toBe('discover')
    expect(getEducationGuide('TAILOR').steps[0].id).toBe('profile-ready')
  })

  it('returns an exact step and fails closed for unknown steps', () => {
    expect(getEducationGuideStep('CUSTOMER', 'fit-profile')?.webPath).toBe('/account/measurements')
    expect(getEducationGuideStep('TAILOR', 'missing')).toBeNull()
  })
})

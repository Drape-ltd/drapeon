import { expect, test } from 'playwright/test'

test.describe('public tailor profile lifecycle analytics', () => {
  test('QA preview explains the consented, media-gated event', async ({ page }) => {
    await page.goto('/analytics-debug')
    await expect(page.getByTestId('analytics-debug-grant')).toBeVisible()
    await page.getByTestId('analytics-debug-grant').click()

    await page.goto('/lifecycle-preview/profile')
    await expect(page.getByRole('heading', { name: 'Public tailor profile analytics' })).toBeVisible()
    const status = page.getByTestId('lifecycle-profile-preview-status')
    await expect(status.getByText('tailor_profile_viewed.v1')).toBeVisible()
    await expect(status).toContainText('tailor_profile_viewed.v1')
    await expect(page.getByText('missing media emits no conversion')).toBeVisible()
  })

  test('missing approved media emits no profile conversion', async ({ page }) => {
    await page.goto('/analytics-debug')
    await page.getByTestId('analytics-debug-grant').click()
    await page.goto('/lifecycle-preview/profile-missing-media')

    await expect(page.getByRole('heading', { name: 'Missing media is not a conversion.' })).toBeVisible()
    await expect(page.getByText('No consented profile event yet.')).toBeVisible()
    await expect(page.getByText('tailor_profile_viewed.v1')).toHaveCount(0)
  })
})

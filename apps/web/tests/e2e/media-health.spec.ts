import { expect, test } from 'playwright/test'

test.describe('public media health boundary', () => {
  test('renders the approved fallback when a public asset fails', async ({ page }) => {
    await page.goto('/media-health-preview')

    await expect(page.getByText('Media failure recovery', { exact: true })).toBeVisible()
    await expect(page.getByText('Media temporarily unavailable', { exact: true })).toHaveCount(2, { timeout: 12000 })
    await expect(page.getByRole('img', { name: 'Intentional media health failure unavailable' })).toBeVisible()
    await expect(page.getByRole('img', { name: 'Intentional media health video failure unavailable' })).toBeVisible()
    await expect(page.getByText('This page did not load cleanly.')).toHaveCount(0)
  })
})

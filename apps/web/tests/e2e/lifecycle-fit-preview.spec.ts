import { expect, test } from 'playwright/test'

test.describe('fit profile lifecycle preview', () => {
  test('keeps the negative path quiet and emits a sanitized completion event', async ({ page }) => {
    await page.goto('/analytics-debug')
    await page.getByTestId('analytics-debug-grant').click()
    await page.goto('/lifecycle-preview/fit-profile')
    await expect(page.getByRole('heading', { name: /fit completion/i })).toBeVisible()

    await page.getByRole('button', { name: 'Simulate incomplete save' }).click()
    await expect(page.getByRole('status')).toContainText(/no conversion event/i)

    await page.getByRole('button', { name: 'Simulate complete save' }).click()
    const status = page.getByTestId('lifecycle-event-preview-status')
    await expect(status.getByText('fit_profile_completed.v1')).toBeVisible()
    await expect(status.getByText('field_count_bucket')).toBeVisible()
    await expect(page.getByText(/measurement values/i)).toHaveCount(0)
  })
})

import { expect, test } from 'playwright/test'

test.describe('lead lifecycle previews', () => {
  test('keeps rejected leads quiet and emits sanitized accepted events', async ({ page }) => {
    await page.goto('/analytics-debug')
    await page.getByTestId('analytics-debug-grant').click()
    await page.goto('/lifecycle-preview/leads')

    await expect(page.getByRole('heading', { name: /lead paths/i })).toBeVisible()
    await page.getByRole('button', { name: 'Simulate invalid submission' }).click()
    await expect(page.getByTestId('lead-preview-status')).toContainText(/no conversion event/i)
    await expect(page.getByTestId('tailor-application-preview-status')).toContainText(/No consented event yet/i)
    await expect(page.getByTestId('waitlist-preview-status')).toContainText(/No consented event yet/i)

    await page.getByRole('button', { name: 'Simulate accepted tailor application' }).click()
    await expect(page.getByText('tailor_application_submitted.v1')).toBeVisible()
    await expect(page.getByText('portfolio_count_bucket')).toBeVisible()

    await page.getByRole('button', { name: 'Simulate accepted waitlist join' }).click()
    await expect(page.getByText('waitlist_joined.v1')).toBeVisible()
    await expect(page.getByText('role')).toBeVisible()
    await expect(page.getByText(/email|portfolio_url|instagram_url/i)).toHaveCount(0)
  })
})

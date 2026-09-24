import { expect, test } from 'playwright/test'

test.describe('lifecycle welcome preview', () => {
  test('renders both role sequences and suppresses duplicate delivery', async ({ page }) => {
    await page.goto('/lifecycle-preview/welcome')
    await expect(page.getByRole('heading', { name: /welcome should feel/i })).toBeVisible()
    await expect(page.getByText('Find work worth wearing.')).toBeVisible()
    await expect(page.getByText(/one immediate message and one delayed/i)).toBeVisible()

    await page.getByRole('button', { name: 'Tailor sequence' }).click()
    await expect(page.getByText('Let your work find its people.')).toBeVisible()
    await expect(page.getByText('drape://profile/setup').first()).toBeVisible()
    await expect(page.getByText(/X-Drapeon-Template-Key: WELCOME_TAILOR_V1/)).toBeVisible()

    await page.getByRole('button', { name: 'Simulate duplicate' }).click()
    await expect(page.getByRole('status')).toContainText(/no second message is queued/i)
  })
})

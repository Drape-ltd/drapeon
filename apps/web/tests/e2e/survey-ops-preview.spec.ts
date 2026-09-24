import { expect, test } from 'playwright/test'

test.describe('development survey Ops preview', () => {
  test('shows aggregated feedback and explicit routing states', async ({ page }) => {
    await page.goto('/survey-ops-preview')

    await expect(page.getByRole('heading', { name: 'Feedback that helps the team act.' })).toBeVisible()
    await expect(page.getByTestId('survey-ops-preview')).toBeVisible()
    await expect(page.getByText('Negative routing')).toBeVisible()
    await expect(page.getByText('1 queued')).toBeVisible()
    await expect(page.getByText('1 held')).toBeVisible()
    await expect(page.getByText('2 eligible')).toBeVisible()
  })

  test('does not render respondent or transaction details', async ({ page }) => {
    await page.goto('/survey-ops-preview')

    const preview = page.getByTestId('survey-ops-preview')
    await expect(preview.getByText(/@[a-z0-9.-]+\.[a-z]{2,}/i)).toHaveCount(0)
    await expect(preview.getByText(/(?:ORD|CASE)-[A-Z0-9-]+/i)).toHaveCount(0)
    await expect(preview.locator('textarea')).toHaveCount(0)
    await expect(preview.getByText('Operators open the private source record only through the governed support path.')).toBeVisible()
  })
})

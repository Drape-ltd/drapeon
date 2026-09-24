import { expect, test } from 'playwright/test'

test.describe('development marketing topics preview', () => {
  test('shows role-eligible channels and lets the user change a topic locally', async ({ page }) => {
    await page.goto('/marketing-topics-preview')

    await expect(page.getByRole('heading', { name: 'Optional, specific, and easy to change.' })).toBeVisible()
    await expect(page.getByTestId('marketing-topic-drapeon_stories')).toBeVisible()
    await expect(page.getByRole('switch', { name: 'Drapeon stories: Email' })).toHaveAttribute('aria-checked', 'false')

    await page.getByRole('switch', { name: 'Drapeon stories: Email' }).click()
    await expect(page.getByRole('switch', { name: 'Drapeon stories: Email' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByText(/Production records each channel choice only after explicit consent/i)).toBeVisible()
    await expect(page.getByTestId('marketing-campaign-binding-preview')).toContainText('Eligible')
  })

  test('does not expose tailor-only topic channels to a customer preview', async ({ page }) => {
    await page.goto('/marketing-topics-preview')

    await expect(page.getByRole('switch', { name: /Drapeon stories: Device/i })).toHaveCount(0)
    await expect(page.getByRole('switch', { name: /New tailor drops: Email/i })).toHaveCount(1)
    await expect(page.getByRole('switch', { name: /Ready-made edits: Device/i })).toHaveCount(1)
    await expect(page.getByTestId('marketing-campaign-binding-preview')).toContainText('Skipped')
  })
})

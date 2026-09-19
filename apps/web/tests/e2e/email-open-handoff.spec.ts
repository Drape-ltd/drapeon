import { expect, test } from 'playwright/test'

test.describe('email app handoff', () => {
  test('shows explicit app, web, and store choices', async ({ page }) => {
    await page.goto('/open?next=%2Fexplore&app=drape%3A%2F%2Forders%2F123')
    await expect(page.getByRole('heading', { name: 'Open this in Drapeon.' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open in Drapeon' })).toHaveAttribute('href', 'drape://orders/123')
    await expect(page.getByRole('link', { name: 'Continue on the web' })).toHaveAttribute('href', '/explore')
    await expect(page.getByRole('link', { name: 'App Store' })).toHaveAttribute('href', 'https://apps.apple.com/app/id6784264202')
    await expect(page.getByRole('link', { name: 'Google Play' })).toHaveAttribute('href', 'https://play.google.com/store/apps/details?id=com.drape.app')
  })

  test('does not render an unsafe app destination', async ({ page }) => {
    await page.goto('/open?next=https%3A%2F%2Fevil.example&app=javascript%3Aalert(1)')
    await expect(page.getByRole('link', { name: 'Open in Drapeon' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Continue on the web' })).toHaveAttribute('href', '/explore')
  })
})

import { expect, test } from 'playwright/test'

const publicFooterDestinations = [
  ['/help', 'Help center'],
  ['/faq', 'FAQ'],
  ['/whats-new', "What's new"],
  ['/explore', 'Explore'],
  ['/how-it-works', 'How it works'],
  ['/tailors', 'For tailors'],
  ['/about', 'About'],
  ['/status', 'Service status'],
  ['/contact', 'Contact'],
  ['/partnerships', 'Partnerships'],
  ['/privacy', 'Privacy & cookies'],
  ['/terms', 'Terms'],
  ['/security', 'Security'],
  ['/trust', 'Trust'],
  ['/payouts', 'Payouts'],
] as const

test.describe('public relationship navigation', () => {
  test('lets a customer share a tailor and expand portfolio work', async ({ page }) => {
    await page.goto('/explore')
    const firstTailor = page.locator('a[href^="/tailors/"]').first()
    await expect(firstTailor).toBeVisible()
    await firstTailor.click()

    await expect(page.getByRole('button', { name: /Share .* profile/ })).toBeVisible()
    await expect(page.getByText('Select any piece to view it full-screen.')).toBeVisible()

    await page.getByRole('button', { name: /Share .* profile/ }).click()
    await expect(page.getByRole('status')).toContainText(/Profile link copied|Copy the profile link/)

    const firstPortfolioImage = page.getByRole('button', { name: /Open .* portfolio image 1 of/ }).first()
    await firstPortfolioImage.click()
    await expect(page.getByRole('dialog', { name: /portfolio viewer/i })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Close portfolio viewer' })).toBeVisible()
  })

  test('keeps the tailor currency primary and labels the USD discovery estimate', async ({ page }) => {
    await page.goto('/explore')
    await expect(page.getByText('Find the right tailor.')).toBeVisible()

    await page.goto('/tailors/ca8b2deb-cccd-4550-9ee5-9ed651989c7a')
    await expect(page.getByText(/USD · estimate/).first()).toBeVisible()
  })

  test('exposes help, education, and trust destinations from the footer', async ({ page }) => {
    await page.goto('/')

    for (const [href, label] of publicFooterDestinations) {
      await expect(page.getByRole('contentinfo').getByRole('link', { name: label, exact: true })).toHaveAttribute('href', href)
    }
  })

  test('unknown public destinations fail closed with recovery choices', async ({ page }) => {
    await page.goto('/this-public-page-does-not-exist')

    await expect(page.getByRole('heading', { name: 'That page is not available.' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to homepage' })).toHaveAttribute('href', '/')
    await expect(page.getByRole('link', { name: 'Explore Drapeon' })).toHaveAttribute('href', '/explore')
    await expect(page.getByRole('link', { name: 'Create account' })).toHaveAttribute('href', '/sign-up')
  })
})

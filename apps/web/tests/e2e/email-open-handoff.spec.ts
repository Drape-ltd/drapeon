import { expect, test } from 'playwright/test'

test.describe('email app handoff', () => {
  test('offers app, web, and store paths for a supported destination', async ({ page }) => {
    await page.goto('/open?next=%2Faccount%2Forders%2Forder-1&app=drape%3A%2F%2Forders%2Forder-1')

    await expect(page.getByRole('heading', { name: 'Open this in Drapeon.' })).toBeVisible()
    await expect(page.getByTestId('open-in-app')).toHaveAttribute('href', 'drape://orders/order-1')
    await expect(page.getByTestId('continue-on-web')).toHaveAttribute(
      'href',
      '/account/orders/order-1'
    )
    await expect(page.getByRole('link', { name: 'App Store' })).toHaveAttribute(
      'href',
      'https://apps.apple.com/app/id6784264202'
    )
    await expect(page.getByRole('link', { name: 'Google Play' })).toHaveAttribute(
      'href',
      'https://play.google.com/store/apps/details?id=com.drape.app'
    )
  })

  test('does not render an app button or external fallback for unsafe parameters', async ({
    page,
  }) => {
    await page.goto('/open?next=https%3A%2F%2Fevil.example%2Fphish&app=javascript%3Aalert(1)')

    await expect(page.getByTestId('open-in-app')).toHaveCount(0)
    await expect(page.getByTestId('continue-on-web')).toHaveAttribute('href', '/explore')
  })
})

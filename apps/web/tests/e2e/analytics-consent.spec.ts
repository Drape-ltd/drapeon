import { expect, test } from 'playwright/test'

test.describe('public analytics consent boundary', () => {
  test('allows analytics only after an explicit opt-in and records a sanitized page event', async ({ page }) => {
    await page.goto('/how-it-works')

    const dialog = page.getByRole('dialog', { name: 'Analytics preference' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Allow analytics' })).toBeVisible()

    await dialog.getByRole('button', { name: 'Allow analytics' }).click()
    await expect(dialog).toHaveCount(0)

    await page.goto('/whats-new')
    await page
      .getByRole('link', { name: /See how it works: Learn how Drapeon keeps a customer and tailor/i })
      .click()
    await page.goto('/analytics-debug')
    await expect(page.getByText('granted', { exact: true })).toBeVisible()
    await expect(page.getByText('4', { exact: true })).toBeVisible()
    await expect(page.getByText('marketing_page_viewed', { exact: true })).toBeVisible()
    await expect(page.getByText('product_update_opened', { exact: true })).toBeVisible()
  })

  test('keeps analytics off after an explicit opt-out and buffers no event', async ({ page }) => {
    await page.goto('/how-it-works')

    const dialog = page.getByRole('dialog', { name: 'Analytics preference' })
    await dialog.getByRole('button', { name: 'Keep analytics off' }).click()
    await expect(dialog).toHaveCount(0)

    await page.goto('/analytics-debug')
    await expect(page.getByText('denied', { exact: true })).toBeVisible()
    await expect(page.getByText('0', { exact: true })).toBeVisible()
    await expect(page.getByText('No consented events have been buffered in this tab.')).toBeVisible()
  })

  test('keeps sanitized QA evidence across navigation and clears it on opt-out', async ({ page }) => {
    await page.goto('/analytics-debug')
    await page.getByTestId('analytics-debug-grant').click()
    await page.goto('/lifecycle-preview/order-start')
    await page.getByRole('button', { name: 'Simulate valid custom brief' }).click()

    await page.goto('/analytics-debug')
    await expect(page.getByText('order_started.v1', { exact: true })).toHaveCount(1)
    await expect(page.getByText('1', { exact: true })).toBeVisible()

    await page.getByTestId('analytics-debug-deny').click()
    await expect(page.getByText('denied', { exact: true })).toBeVisible()
    await expect(page.getByText('0', { exact: true })).toBeVisible()
    await expect(page.getByText('No consented events have been buffered in this tab.')).toBeVisible()
  })

  test('records a sanitized marketing CTA conversion only after opt-in', async ({ page }) => {
    await page.goto('/pricing')

    const dialog = page.getByRole('dialog', { name: 'Analytics preference' })
    await dialog.getByRole('button', { name: 'Allow analytics' }).click()
    await expect(dialog).toHaveCount(0)

    await page.getByRole('link', { name: 'Create account' }).click()
    await page.goto('/analytics-debug')

    await expect(page.getByText('marketing_cta_clicked.v1', { exact: true })).toHaveCount(1)
    await expect(page.getByText('pricing', { exact: true })).toBeVisible()
    await expect(page.getByText('Pricing create account', { exact: true })).toBeVisible()
  })
})

import { expect, test } from 'playwright/test'

test.describe('lifecycle order-start preview', () => {
  test('keeps blocked contexts out and records a consented valid context', async ({ page }) => {
    await page.goto('/analytics-debug')
    await page.getByTestId('analytics-debug-grant').click()
    await page.goto('/lifecycle-preview/order-start')

    await page.getByRole('button', { name: 'Simulate blocked context' }).click()
    await expect(page.getByRole('status')).toContainText(/no order intent event/i)
    await expect(page.getByText('No consented event yet.')).toBeVisible()

    await page.getByRole('button', { name: 'Simulate valid custom brief' }).click()
    await expect(page.getByRole('status')).toContainText(/order intent emitted/i)
    const status = page.getByTestId('lifecycle-event-preview-status')
    await expect(status.getByText('order_started.v1')).toHaveCount(1)
    await expect(status.getByText('"order_kind": "custom"')).toBeVisible()
    await expect(status.getByText('"tailor_id_hash":')).toBeVisible()
    await expect(page.getByText(/private order data/i)).toHaveCount(1)
  })
})

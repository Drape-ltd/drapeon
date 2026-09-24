import { expect, test } from 'playwright/test'

test.describe('development order lifecycle preview', () => {
  test('replays a custom order to completion and keeps payout separate', async ({ page }) => {
    await page.goto('/lifecycle-preview/order-timeline')

    await expect(page.getByRole('heading', { name: 'One order thread, through handoff and payout.' })).toBeVisible()
    await expect(page.getByTestId('order-stage-label')).toContainText('Quote approved')
    await expect(page.getByTestId('order-payout-status')).toContainText('Not started')

    for (let step = 0; step < 4; step += 1) {
      await page.getByRole('button', { name: 'Advance order' }).click()
    }

    await expect(page.getByTestId('order-stage-label')).toContainText('Complete')
    await expect(page.getByTestId('order-payout-status')).toContainText('Released — provider confirmed')
    await expect(page.getByRole('status')).toContainText(/separate events/i)
    await expect(page.getByRole('button', { name: 'Simulate provider hold' })).toBeDisabled()
  })

  test('shows a recoverable provider hold before release', async ({ page }) => {
    await page.goto('/lifecycle-preview/order-timeline')

    for (let step = 0; step < 3; step += 1) {
      await page.getByRole('button', { name: 'Advance order' }).click()
    }
    await page.getByRole('button', { name: 'Simulate provider hold' }).click()

    await expect(page.getByRole('alert')).toContainText(/provider confirmation is pending/i)
    await expect(page.getByTestId('order-payout-status')).toContainText('On hold')
    await expect(page.getByRole('button', { name: 'Advance order' })).toBeDisabled()
  })

  test('switches to the ready-made branch without custom production stages', async ({ page }) => {
    await page.goto('/lifecycle-preview/order-timeline')
    await page.getByRole('tab', { name: 'Ready-made' }).click()

    await expect(page.getByTestId('order-stage-label')).toContainText('Order placed')
    await expect(page.getByTestId('order-lifecycle-timeline')).toContainText('Dispatched')
    await expect(page.getByTestId('order-lifecycle-timeline')).not.toContainText('In production')
  })
})

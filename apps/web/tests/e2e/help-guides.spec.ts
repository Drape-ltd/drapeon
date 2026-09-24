import { expect, test } from 'playwright/test'

test.describe('public help education guides', () => {
  test.beforeEach(async ({ page }) => {
    // Each path must begin with an empty consent/progress store. Without this,
    // a completed guide in a prior case makes the next case exercise a disabled
    // control instead of the intended happy path.
    await page.goto('/analytics-debug')
    await page.evaluate(() => {
      window.localStorage.clear()
      window.sessionStorage.clear()
    })
    await page.reload()
  })

  test('shows customer and tailor starter paths with usable destinations', async ({ page }) => {
    await page.goto('/help')

    await expect(page.getByRole('heading', { name: 'A short guide for each side of the relationship.' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Start as a Drapeon customer' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Start as a Drapeon tailor' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Learn more' }).first()).toHaveAttribute('href', '/explore')
    await expect(page.getByRole('link', { name: 'See the next step' }).last()).toHaveAttribute('href', '/payouts')
  })

  test('does not present a guide step as a conversion or payment action', async ({ page }) => {
    await page.goto('/help')

    await expect(page.getByRole('button', { name: /buy|pay|place order/i })).toHaveCount(0)
    await expect(page.getByText('The guide explains the workflow without interrupting an active order.')).toBeVisible()
  })

  test('records a consented guide start without private guide content', async ({ page }) => {
    await page.goto('/analytics-debug')
    await page.getByTestId('analytics-debug-grant').click()
    await page.goto('/help')

    await page.getByRole('link', { name: 'Learn more' }).first().click()
    await expect(page).toHaveURL(/\/explore$/)
    await expect(page.getByRole('heading', { name: 'Find the right tailor.' })).toBeVisible()
    await expect(page.getByText('This page did not load cleanly.')).toHaveCount(0)
    await page.goto('/analytics-debug')

    await expect(page.getByText('guide_started.v1', { exact: true })).toBeVisible()
    await expect(page.getByText(/"guide_id": "customer-start-here"/)).toBeVisible()
    await expect(page.getByText('fit_profile', { exact: true })).toHaveCount(0)
    await expect(page.getByText('measurement', { exact: true })).toHaveCount(0)
  })

  test('persists a guide completion and emits it only once', async ({ page }) => {
    await page.goto('/analytics-debug')
    await page.getByTestId('analytics-debug-grant').click()
    await page.goto('/help')

    const complete = page.getByTestId('guide-complete-customer-start-here')
    await expect(complete).toHaveText('Mark guide complete')
    await complete.click()
    await expect(complete).toHaveText('Guide complete')
    await expect(page.getByText('Saved on this device for this guide version.')).toBeVisible()

    await page.reload()
    await expect(complete).toHaveText('Guide complete')
    await expect(complete).toBeDisabled()
    await page.goto('/analytics-debug')
    await expect(page.getByText('guide_completed.v1', { exact: true })).toHaveCount(1)
    await expect(page.getByText(/"guide_id": "customer-start-here"/)).toHaveCount(1)
  })

  test('fails closed when guide progress cannot be saved', async ({ page }) => {
    await page.addInitScript(() => {
      const originalSetItem = Storage.prototype.setItem
      Storage.prototype.setItem = function setItem(key: string, value: string) {
        if (key.startsWith('drapeon.education-guide.')) throw new Error('guide progress storage blocked')
        originalSetItem.call(this, key, value)
      }
    })

    await page.goto('/analytics-debug')
    await page.getByTestId('analytics-debug-grant').click()
    await page.goto('/help')
    await page.getByTestId('guide-complete-customer-start-here').click()

    await expect(page.getByText('Progress could not be saved on this device. Try again when storage is available.')).toBeVisible()
    await page.goto('/analytics-debug')
    await expect(page.getByText('guide_completed.v1', { exact: true })).toHaveCount(0)
  })
})

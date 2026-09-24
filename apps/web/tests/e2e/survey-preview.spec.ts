import { expect, test } from 'playwright/test'

test.describe('development survey preview', () => {
  test('renders and completes the post-completion feedback path', async ({ page }) => {
    await page.goto('/survey-preview')

    await expect(page.getByRole('heading', { name: 'Private feedback, without pressure.' })).toBeVisible()
    await expect(page.getByTestId('lifecycle-survey-card')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'How did the finished order feel?' })).toBeVisible()
    await page.getByRole('radio', { name: '3 out of 5' }).click()
    await page.getByRole('button', { name: 'Fit' }).click()
    await page.getByRole('button', { name: 'Send private feedback' }).click()
    await expect(page.getByTestId('lifecycle-survey-submitted')).toContainText('Feedback received')
    await expect(page.getByRole('button', { name: 'Send private feedback' })).toHaveCount(0)
  })

  test('keeps the feedback surface informational and does not expose payment actions', async ({ page }) => {
    await page.goto('/survey-preview')

    await expect(page.getByRole('button', { name: /pay|buy|place order/i })).toHaveCount(0)
    await expect(page.getByText('It never changes your service, payout, or access.')).toBeVisible()
  })

  test('renders explicit submitted and suppressed recovery states', async ({ page }) => {
    await page.goto('/survey-preview/submitted')
    await expect(page.getByTestId('lifecycle-survey-submitted')).toContainText('Feedback received')

    await page.goto('/survey-preview/suppressed')
    await expect(page.getByTestId('lifecycle-survey-suppressed')).toContainText('Feedback paused')
    await expect(page.getByText('You do not need to submit a rating')).toBeVisible()
  })
})

import { expect, test } from 'playwright/test'

test.describe('development email previews', () => {
  test('renders customer and tailor welcome sequences with safe destinations', async ({ page }) => {
    await page.goto('/email-preview?kind=customer')
    await expect(page.getByRole('heading', { name: 'Find work worth wearing.' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Explore Drapeon' })).toHaveAttribute(
      'href',
      'https://drapeon.co/open?next=%2Fexplore&app=drape%3A%2F%2F',
    )

    await page.goto('/email-preview?kind=customer-next')
    await expect(page.getByRole('heading', { name: 'A better fit starts with your profile.' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Complete your fit profile' })).toHaveAttribute(
      'href',
      'https://drapeon.co/open?next=%2Faccount%2Fmeasurements&app=drape%3A%2F%2F',
    )

    await page.goto('/email-preview?kind=tailor')
    await expect(page.getByRole('heading', { name: 'Let your work find its people.' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open your tailor profile' })).toHaveAttribute(
      'href',
      'https://drapeon.co/open?next=%2Faccount%2Fprofile%3Fsetup%3D1&app=drape%3A%2F%2F',
    )

    await page.goto('/email-preview?kind=tailor-next')
    await expect(page.getByRole('heading', { name: 'Show the craft behind the name.' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Continue tailor setup' })).toHaveAttribute(
      'href',
      'https://drapeon.co/open?next=%2Faccount%2Fprofile%3Fsetup%3D1&app=drape%3A%2F%2F',
    )
  })

  test('fails closed to the safe customer preview for an unknown kind', async ({ page }) => {
    await page.goto('/email-preview?kind=unknown')
    await expect(page.getByRole('heading', { name: 'Find work worth wearing.' })).toBeVisible()
    await expect(page.getByText('Show the craft behind the name.')).toHaveCount(0)
  })

  test('keeps payment details readable in the dark-mode preview', async ({ page }) => {
    await page.goto('/email-preview?kind=payment')
    await expect(page.getByRole('heading', { name: 'Payment received' })).toBeVisible()
    await expect(page.getByText('Order', { exact: true })).toBeVisible()
    await expect(page.getByText('#DRP-2048', { exact: true })).toBeVisible()
    await expect(page.getByText('Amount', { exact: true })).toBeVisible()
    await expect(page.getByText('£240.00', { exact: true })).toBeVisible()
    await expect(page.getByText('Status', { exact: true })).toBeVisible()
    await expect(page.getByText('Order funded', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Track your order' })).toHaveAttribute(
      'href',
      'https://drapeon.co/account/orders/DRP-2048',
    )
  })
})

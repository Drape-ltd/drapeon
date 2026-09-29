import { test, expect } from 'playwright/test'

test('customer-mode handoff is explicit and an expired session offers recovery', async ({ page }) => {
  await page.goto('/fulfillment-preview/role')
  await expect(page.getByRole('heading', { name: 'Finish your fulfillment setup' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Stay in customer mode' })).toHaveAttribute('href', '/account/orders')
  await page.getByRole('button', { name: 'Switch to tailor mode to finish setup' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Your sign-in expired.' })).toHaveText('Your sign-in expired. Sign in again to continue.')
  await expect(page.getByRole('button', { name: 'Switch to tailor mode to finish setup' })).toBeEnabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
})

test('signed-out repair entry retains the exact destination through sign-in', async ({ page }) => {
  await page.goto('/account/profile?fulfillment=1#fulfillment')
  const signIn = page.getByRole('link', { name: 'Sign in', exact: true })
  await expect(signIn).toHaveAttribute('href', '/sign-in?next=%2Faccount%2Fprofile%3Ffulfillment%3D1%23fulfillment')
  await signIn.click()
  await expect(page).toHaveURL(/next=%2Faccount%2Fprofile%3Ffulfillment%3D1%23fulfillment/)
  await expect(page.getByRole('heading', { name: 'Sign in to Drapeon.' })).toBeVisible()
})

test('brief never invents collection and keeps input when origin becomes ready', async ({ page }) => {
  await page.goto('/fulfillment-preview')
  const choice = page.getByRole('combobox', { name: 'Fulfillment', exact: true })
  await expect(choice).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled()
  await expect(choice.locator('option[value="LOCAL_COLLECTION"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Toggle repaired origin' }).click()
  await expect(choice).toBeEnabled()
  await expect(choice.locator('option[value="LOCAL_DELIVERY"]')).toHaveCount(1)
  await expect(choice.locator('option[value="LOCAL_COLLECTION"]')).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Recipient name', exact: true }).fill('Synthetic recipient')
  await page.getByRole('button', { name: 'Toggle repaired origin' }).click()
  await expect(choice).toBeDisabled()
  await expect(page.getByRole('textbox', { name: 'Recipient name', exact: true })).toHaveValue('Synthetic recipient')
})

test('fulfillment repair warning opens exact section and missing-address save is actionable', async ({ page }) => {
  await page.goto('/account-preview?state=selling-setup&fulfillment=1#fulfillment')
  await expect(page.getByRole('heading', { name: 'Finish fulfillment setup so customers can place new orders' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Finish fulfillment setup', exact: true })).toHaveAttribute('href', '/account/profile?fulfillment=1#fulfillment')
  await expect(page.locator('details').first()).toHaveAttribute('open', '')
  await expect(page.getByRole('switch', { name: 'Delivery available' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: 'Save selling setup' }).click()
  await expect(page.getByText('Add your fulfillment origin address before offering pickup, delivery, or shipping.', { exact: true })).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Delivery available' })).toHaveAttribute('aria-checked', 'true')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('ready-made checkout fails closed and retry restores only enabled methods', async ({ page }) => {
  let repaired = false
  await page.route('**/functions/v1/read-gateway', async route => {
    if (route.request().postDataJSON()?.action !== 'fulfillment-options') return route.continue()
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { originReady: repaired, methods: repaired ? ['LOCAL_DELIVERY', 'SHIPPING'] : [] } }) })
  })
  await page.goto('/account-preview?state=ready-made-checkout')
  await expect(page.getByRole('status')).toContainText('This seller is completing fulfillment setup. No method is available for this item yet.')
  const choice = page.getByRole('combobox', { name: 'Fulfillment', exact: true })
  await expect(choice).toBeDisabled()
  repaired = true
  await page.getByRole('button', { name: 'Check again', exact: true }).click()
  await expect(choice).toBeEnabled()
  await expect(choice.locator('option[value="PICKUP"]')).toHaveCount(0)
  await expect(choice.locator('option[value="DELIVERY"]')).toHaveCount(1)
})

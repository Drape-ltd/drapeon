import { expect, test } from 'playwright/test'

test.describe("public What's New feed", () => {
  test('renders a concise public update with an exact next-step destination', async ({ page }) => {
    await page.goto('/whats-new')

    await expect(page.getByRole('heading', { name: 'Small improvements, clearly explained.' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'One clear order thread' })).toBeVisible()
    await expect(page.getByRole('link', { name: /See how it works:/i })).toHaveAttribute(
      'href',
      '/how-it-works',
    )
  })

  test('does not leak role-targeted update content into the public feed', async ({ page }) => {
    await page.goto('/whats-new')

    await expect(page.getByRole('heading', { name: 'Ready-made items belong beside your craft' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Make your fit reusable' })).toHaveCount(0)
  })
})

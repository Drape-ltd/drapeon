import { expect, test } from 'playwright/test'

test.describe('account extraction preview', () => {
  test('renders signed-out and loading route states without overflow', async ({ page }) => {
    await page.goto('/account-preview?state=auth-required')

    await expect(page.getByRole('heading', { name: 'Sign in to continue.' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/sign-in?next=%2Faccount%2Forders'
    )
    await expect(page.getByRole('link', { name: 'Create account' })).toHaveAttribute(
      'href',
      '/sign-up'
    )

    await page.getByRole('button', { name: 'Loading' }).click()
    await expect(page.getByText('Loading account.')).toBeAttached()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow, 'account preview horizontal overflow').toBeLessThanOrEqual(1)
  })

  test('renders a populated authenticated message thread without overflow', async ({ page }) => {
    await page.goto('/account-preview?state=messages&orderId=preview-order')

    await expect(page.getByText('Abeni Atelier', { exact: true }).first()).toBeVisible()
    await expect(
      page.getByText('Hi! I love the progress. Could we keep the jacket slightly cropped?')
    ).toBeVisible()
    await expect(page.getByPlaceholder('Message...')).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow, 'message fixture horizontal overflow').toBeLessThanOrEqual(1)
  })

  test('renders authenticated tailor order actions without overflow', async ({ page }) => {
    await page.goto('/account-preview?state=tailor-order')

    await expect(page.getByRole('heading', { name: 'DRP-PREVIEW-1042' })).toBeVisible()
    await expect(page.getByText('Update production stage')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Update stage' })).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow, 'tailor order fixture horizontal overflow').toBeLessThanOrEqual(1)
  })

  test('renders authenticated customer order actions without overflow', async ({ page }) => {
    await page.goto('/account-preview?state=customer-order')

    await expect(page.getByRole('heading', { name: 'DRP-PREVIEW-1042' })).toBeVisible()
    await expect(page.getByText('Request change')).toBeVisible()
    await expect(page.getByText('Event emergency')).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow, 'customer order fixture horizontal overflow').toBeLessThanOrEqual(1)
  })

  test('renders a verified payout destination without overflow', async ({ page }) => {
    await page.goto('/account-preview?state=payout')

    await expect(page.getByText('Where earnings are sent')).toBeVisible()
    await expect(page.getByText('Preview Bank')).toBeVisible()
    await expect(page.getByText('Ready when earnings are eligible')).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow, 'payout fixture horizontal overflow').toBeLessThanOrEqual(1)
  })

  test('renders payout and settlement history without overflow', async ({ page }) => {
    await page.goto('/account-preview?state=earnings')

    await expect(page.getByText('Transaction history')).toBeVisible()
    await expect(page.getByText('Payout history')).toBeVisible()
    await expect(page.getByText('DRP-PAID-1041').first()).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow, 'earnings fixture horizontal overflow').toBeLessThanOrEqual(1)
  })

  test('renders authenticated shop management without overflow', async ({ page }) => {
    await page.goto('/account-preview?state=shop')

    await expect(page.getByText('Total items')).toBeVisible()
    await expect(page.getByText('Published').first()).toBeVisible()
    await expect(page.getByText('Manage existing listings')).toBeVisible()
    await expect(page.getByText('Emerald occasion set')).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow, 'shop fixture horizontal overflow').toBeLessThanOrEqual(1)
  })

  test('renders approved trust review without overflow', async ({ page }) => {
    await page.goto('/account-preview?state=identity-approved')

    await expect(page.getByText('Trust review approved')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Continue to dashboard' })).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow, 'approved identity fixture horizontal overflow').toBeLessThanOrEqual(1)
  })

  test('renders rejected profile-photo review without overflow', async ({ page }) => {
    await page.goto('/account-preview?state=identity-rejected')

    await expect(page.getByText('Profile photo needs replacement')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Upload replacement photo' })).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow, 'rejected identity fixture horizontal overflow').toBeLessThanOrEqual(1)
  })

  test('renders authenticated portfolio management without overflow', async ({ page }) => {
    await page.goto('/account-preview?state=portfolio')

    await expect(page.getByRole('heading', { name: 'Your work' })).toBeVisible()
    await expect(page.getByText('Emerald evening set')).toBeVisible()
    await expect(page.getByText('Choose the best frame for each piece')).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow, 'portfolio fixture horizontal overflow').toBeLessThanOrEqual(1)
  })

  test('renders the tailor selling setup without overflow', async ({ page }) => {
    await page.goto('/account-preview?state=selling-setup')

    await expect(page.getByRole('textbox', { name: 'Public display name' })).toHaveValue(
      'Abeni Atelier'
    )
    await expect(page.getByText('Consultation policy')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save selling setup' })).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow, 'selling setup fixture horizontal overflow').toBeLessThanOrEqual(1)
  })

  test('renders customer material-advance approval without overflow', async ({ page }) => {
    await page.goto('/account-preview?state=material-advance')

    await expect(page.getByRole('heading', { name: 'Protected material costs' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Aso-oke fabric deposit' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Decline', exact: true })).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow, 'material advance fixture horizontal overflow').toBeLessThanOrEqual(1)
  })

  test('renders customer dispatch decision without overflow', async ({ page }) => {
    await page.goto('/account-preview?state=dispatch')

    await page.getByText('Delivery choice needed').first().click()
    await expect(page.getByRole('heading', { name: 'Delivery price' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Pay .* difference/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Find a cheaper option' })).toBeVisible()
    await expect(page.getByText('Provider price confirmed for local delivery.')).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow, 'dispatch fixture horizontal overflow').toBeLessThanOrEqual(1)
  })

  test('renders ready-made checkout without overflow', async ({ page }) => {
    await page.goto('/account-preview?state=ready-made-checkout')

    await expect(page.getByRole('heading', { name: 'Start ready-made checkout' })).toBeVisible()
    await expect(page.getByText('Confirm the fit')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Preview tax and total' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Review payment' })).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow, 'ready-made checkout fixture horizontal overflow').toBeLessThanOrEqual(1)
  })

  test('renders tailor profile overview without overflow', async ({ page }) => {
    await page.goto('/account-preview?state=profile-overview')

    await expect(page.getByRole('heading', { name: 'Abeni Atelier' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Go-live checklist' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Your work' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Review payout setup' })).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow, 'profile overview fixture horizontal overflow').toBeLessThanOrEqual(1)
  })

  test('renders delivered-order resolution panels without overflow', async ({ page }) => {
    await page.goto('/account-preview?state=order-resolution')

    await expect(page.getByText('Returns and remedies')).toBeVisible()
    await expect(page.getByText('Refund processing').first()).toBeVisible()
    await expect(page.getByText('Propose a formal change')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Rate this tailor' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Tip your tailor' })).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow, 'order resolution fixture horizontal overflow').toBeLessThanOrEqual(1)
  })

  test('renders the complete order detail coordinator without overflow', async ({ page }) => {
    await page.goto('/account-preview?state=order-detail')

    await expect(page.getByRole('heading', { name: 'Two-piece set' })).toBeVisible()
    await expect(page.getByText('Stage progress')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Payments' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Messages' })).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow, 'order detail fixture horizontal overflow').toBeLessThanOrEqual(1)
  })

  test('renders extracted marketplace surfaces without overflow', async ({ page }) => {
    await page.goto('/account-preview?state=marketplace-surfaces')

    await expect(page.getByText('All tailors')).toBeVisible()
    await expect(page.getByText('Saved tailors').first()).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Abeni Atelier' }).first()).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Emerald occasion set' }).last()).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow, 'marketplace surfaces fixture horizontal overflow').toBeLessThanOrEqual(1)
  })

  test('renders order list, tailor work, and checkout surfaces without overflow', async ({ page }) => {
    await page.goto('/account-preview?state=order-list-surfaces')

    await expect(page.getByRole('button', { name: 'Active 1' })).toBeVisible()
    await expect(page.getByText('Tailor cockpit')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start secure checkout' })).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow, 'order list surfaces fixture horizontal overflow').toBeLessThanOrEqual(1)
  })

  test('renders settings and support surfaces without overflow', async ({ page }) => {
    await page.goto('/account-preview?state=settings-support')

    await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Security' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Common questions' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Ask Drapeon for help' })).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow, 'settings and support fixture horizontal overflow').toBeLessThanOrEqual(1)
  })
})

import path from 'node:path'
import { expect, test, type Page } from 'playwright/test'

const avatarFixture = path.resolve(
  process.cwd(),
  'public/editorial/drapeon-pattern-planning-v1.jpg'
)

async function fillValidCredentials(page: Page) {
  await page.getByLabel('Display name').fill('Signup QA')
  await page.getByLabel('Phone number *').fill('2025550147')
  await page.getByLabel('Email').fill('signup-qa@example.com')
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('Drapeon-QA-4821!')
  await page
    .getByRole('textbox', { name: 'Confirm password', exact: true })
    .fill('Drapeon-QA-4821!')
}

async function expectHeadingBelowStickyHeader(page: Page, name: string) {
  const header = await page.locator('header').boundingBox()
  const heading = await page.getByRole('heading', { name }).boundingBox()
  expect(header).not.toBeNull()
  expect(heading).not.toBeNull()
  expect(heading!.y).toBeGreaterThanOrEqual(header!.y + header!.height)
}

test.describe('create-account flow', () => {
  test('keeps validation local and explains an unsupported profile photo', async ({ page }) => {
    await page.goto('/sign-up')

    await fillValidCredentials(page)
    await page
      .getByRole('textbox', { name: 'Confirm password', exact: true })
      .fill('Different-QA-4821!')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(
      page.getByRole('alert').filter({ hasText: /passwords do not match/i })
    ).toBeVisible()

    await page.locator('input[type="file"]').setInputFiles({
      name: 'avatar.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not an image'),
    })
    await expect(
      page.getByRole('alert').filter({ hasText: 'JPG, PNG, or WebP image under 10 MB' })
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Start your Drapeon account.' })).toBeVisible()
  })

  test('previews a selected profile photo and preserves it across account-role steps', async ({
    page,
  }) => {
    await page.goto('/sign-up')

    await expect(page.getByRole('heading', { name: 'Start your Drapeon account.' })).toBeVisible()

    await page.locator('input[type="file"]').setInputFiles(avatarFixture)
    await expect(page.getByRole('img', { name: 'Profile photo preview' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Change' })).toBeVisible()

    await fillValidCredentials(page)
    await page.getByRole('button', { name: 'Continue', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'Choose your role.' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Customer Find tailors/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expectHeadingBelowStickyHeader(page, 'Choose your role.')

    await page.getByRole('button', { name: /Tailor Build your storefront/ }).click()
    await expect(
      page.getByRole('button', { name: /Tailor Build your storefront/ })
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText(/studio setup follows confirmation/i)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Your identity.' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(page.getByRole('img', { name: 'Profile photo preview' })).toBeVisible()
    await page.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(page.getByRole('img', { name: 'Profile photo preview' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add photo' })).toBeVisible()
  })

  test('identifies selected customer setup choices for assistive technology', async ({ page }) => {
    await page.goto('/sign-up')
    await fillValidCredentials(page)
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()

    await page.getByRole('button', { name: 'Centimetres' }).click()
    await page.getByRole('button', { name: /Both I order/ }).click()

    await expect(page.getByRole('button', { name: 'Centimetres' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(page.getByRole('button', { name: 'Inches' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    await expect(page.getByRole('button', { name: /Both I order/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  test('keeps every signup step within a narrow viewport', async ({ page }) => {
    await page.goto('/sign-up')
    await fillValidCredentials(page)

    for (const expectedHeading of [
      'Start your Drapeon account.',
      'Choose your role.',
      'Tell tailors about your style.',
    ]) {
      await expect(page.getByRole('heading', { name: expectedHeading })).toBeVisible()
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
      expect(overflow, `${expectedHeading} horizontal overflow`).toBeLessThanOrEqual(1)
      if (expectedHeading !== 'Tell tailors about your style.') {
        await page.getByRole('button', { name: 'Continue', exact: true }).click()
      }
    }
  })

  test('tailor registration confirms the account before mandatory studio setup', async ({
    page,
  }) => {
    await page.goto('/sign-up?role=TAILOR')
    await fillValidCredentials(page)
    await page.getByRole('button', { name: 'Continue', exact: true }).click()

    await expect(
      page.getByRole('button', { name: /Tailor Build your storefront/ })
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText(/studio setup follows confirmation/i)).toBeVisible()
    await expect(
      page.getByText(
        /Boutique and Tailor Shop accounts must add their first hidden ready-made proof item/i
      )
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create account' })).toBeDisabled()
    await expect(page.getByRole('heading', { name: 'Your identity.' })).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'City or base location' })).toHaveCount(0)
  })

  test('social signup reaches role choice without requiring profile fields first', async ({ page }) => {
    await page.goto('/sign-up?role=TAILOR')
    await page.getByRole('button', { name: 'Continue with Google' }).click()

    await expect(page.getByRole('heading', { name: 'Choose your role.' })).toBeVisible()
    await expect(
      page.getByRole('button', { name: /Tailor Build your storefront/ })
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(
      page.getByText(/phone number before continuing with google or apple/i)
    ).toHaveCount(0)
  })

  test('provider signup carries a selected profile photo for both account roles', async ({
    page,
  }) => {
    await page.route('**/auth/v1/authorize**', async (route) => route.abort())

    for (const role of ['CUSTOMER', 'TAILOR'] as const) {
      // Clear before React mounts. Clearing a live form lets its draft-save
      // effect immediately write the old role and step back into storage.
      await page.addInitScript(() => window.localStorage.clear())
      await page.goto(`/sign-up?role=${role}`)

      await page.locator('input[type="file"]').setInputFiles(avatarFixture)
      await page.getByLabel('Display name').fill(`${role} OAuth photo`)
      await page.getByLabel('Phone number *').fill('2025550147')
      await page.getByRole('button', { name: 'Continue with Google' }).click()
      await expect(page.getByRole('heading', { name: 'Choose your role.' })).toBeVisible()

      await page.getByRole('button', { name: 'Continue with Google' }).click()
      await page.waitForTimeout(300)

      const storage = await page.context().storageState()
      const origin = storage.origins.find((entry) => entry.origin === 'http://127.0.0.1:3004')
      const rawDraft = origin?.localStorage.find(
        (entry) => entry.name === 'drapeon.web.auth.oauth-signup-draft.v1'
      )?.value
      const draft = rawDraft ? JSON.parse(rawDraft) : null

      expect(draft).toMatchObject({
        role,
        phone: '+12025550147',
        avatarDraft: { key: expect.stringMatching(/^avatar:/) },
      })
    }
  })

  test('signup falls back to the product default phone country when the browser has no region', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'language', { configurable: true, get: () => 'en' })
      Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['en'] })
    })
    await page.goto('/sign-up?role=TAILOR')

    await expect(
      page.getByRole('combobox', { name: 'Country code, United States +1' })
    ).toBeVisible()
  })

  test('restores the public studio draft after a reload without restoring passwords', async ({
    page,
  }) => {
    await page.goto('/sign-up')
    await page.locator('input[type="file"]').first().setInputFiles(avatarFixture)
    await fillValidCredentials(page)
    await page.getByLabel('Display name').fill('Reload Proof Tailor')
    await expect(page.getByRole('img', { name: 'Profile photo preview' })).toBeVisible()
    await page.reload()

    await expect(page.getByLabel('Display name')).toHaveValue('Reload Proof Tailor')
    await expect(page.getByRole('img', { name: 'Profile photo preview' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Password', exact: true })).toHaveValue('')
    await expect(page.getByText(/saved signup draft was restored/i)).toBeVisible()
  })

  test('an explicit signup role overrides a stale draft role', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'drapeon.web.auth.signup-draft.v1',
        JSON.stringify({
          step: 1,
          role: 'CUSTOMER',
          displayName: 'Old Customer Draft',
        })
      )
    })
    await page.goto('/sign-up?role=TAILOR')
    await page.getByLabel('Display name').fill('OAuth QA Tailor')
    await page.getByLabel('Phone number *').fill('2025550147')
    await page.getByRole('button', { name: 'Continue with Google' }).click()

    await expect(
      page.getByRole('button', { name: /Tailor Build your storefront/ })
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: /Customer Find tailors/ })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  test('clears a legacy post-submit checkpoint so another person can start signup', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'drapeon.web.auth.signup-draft.v1',
        JSON.stringify({
          step: 6,
          pendingConfirmationEmail: 'resume@example.com',
          role: 'TAILOR',
          displayName: 'Resume Tailor',
          phone: '+12025550123',
          email: 'resume@example.com',
        })
      )
    })
    await page.goto('/sign-up?role=TAILOR')

    await expect(page.getByRole('heading', { name: 'Start your Drapeon account.' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Check your inbox' })).toHaveCount(0)
    await expect(page.getByText('resume@example.com')).toHaveCount(0)
    await expect(page.getByLabel('Display name')).toHaveValue('')
    await expect(page.getByLabel('Email')).toHaveValue('')
  })
})

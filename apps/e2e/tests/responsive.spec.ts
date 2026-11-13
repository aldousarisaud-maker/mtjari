import { expect, test, type Page } from '@playwright/test';

/** A page wider than the device makes mobile browsers widen the layout viewport, so measure against the device width. */
const pageWidth = (page: Page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth, window.innerWidth));

for (const path of ['/ar', '/en', '/ar/login', '/ar/register']) {
  test(`no horizontal overflow on ${path}`, async ({ page }) => {
    await page.goto(path);
    expect(await pageWidth(page)).toBeLessThanOrEqual(page.viewportSize()!.width);
  });
}

test('dashboard catalogue pages fit the screen (Arabic and English)', async ({ page }, info) => {
  const { login, register } = await import('./helpers');
  const email = `layout.${info.project.name}@example.com`;
  await register(page, email, 'تجربة');
  await login(page, email);
  await page.goto('/ar/dashboard/new');
  await page.getByLabel('رابط المتجر').fill(`layout-${info.project.name}`);
  await expect(page.getByText('الرابط متاح')).toBeVisible();
  await page.getByLabel('اسم المتجر').fill('متجر العرض');
  await page.getByRole('button', { name: 'إنشاء المتجر' }).click();
  await expect(page).toHaveURL(/\/ar\/dashboard\/[0-9a-f-]{36}$/);
  const store = new URL(page.url()).pathname;

  await page.goto(`${store}/products/new`);
  await page.getByLabel('الاسم بالعربية').fill('عطر العنبر الملكي');
  await page.getByLabel('السعر', { exact: true }).fill('18.750');
  await page.getByLabel('الكمية', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'إنشاء المنتج' }).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/);
  const product = new URL(page.url()).pathname;

  for (const path of [store, `${store}/products`, `${store}/products/new`, product, `${store}/categories`, `${store}/brands`, `${store}/inventory`]) {
    for (const p of [path, path.replace('/ar/', '/en/')]) {
      await page.goto(p);
      await expect(page.locator('html')).toHaveAttribute('dir', p.startsWith('/ar/') ? 'rtl' : 'ltr');
      expect(await pageWidth(page), p).toBeLessThanOrEqual(page.viewportSize()!.width);
      // Optional: SHOT_DIR=/some/folder saves a picture of every page for visual review.
      if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${info.project.name}${p.replace(store.replace('/ar/', p.slice(0, 4)), '').replace(/[0-9a-f-]{36}/, 'product').replaceAll('/', '_') || '_home'}-${p.slice(1, 3)}.png`, fullPage: true });
    }
  }
  // English labels are real translations, not Arabic left-overs.
  await page.goto(`${store.replace('/ar/', '/en/')}/products`);
  await expect(page.getByRole('link', { name: 'New product' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'عطر العنبر الملكي' })).toContainText('18.750');
});

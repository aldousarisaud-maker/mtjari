import { expect, test, type Page } from '@playwright/test';
import { apiCall, seedShop, shopUrl, type SeededShop } from './helpers';

const THEMES = ['modern-electronics', 'luxury-fashion', 'perfume-boutique', 'coffee-house', 'gulf-premium'] as const;
let shop: SeededShop;

/** A page wider than the device makes mobile browsers widen the layout viewport, so measure against the device width. */
const pageWidth = (page: Page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth, window.innerWidth));

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }, info) => {
  const page = await browser.newPage();
  const slug = `themes-${info.project.name}`;
  shop = await seedShop(page, `themes.${info.project.name}@example.com`, slug, 'متجر القوالب');
  await apiCall(shop.token, 'POST', `/v1/stores/${shop.storeId}/theme/publish`, { themeId: 'gulf-premium' });
  await apiCall(shop.token, 'POST', `/v1/stores/${shop.storeId}/launch`);
  // Checkout is on: cash on delivery, one delivery zone and pickup.
  await apiCall(shop.token, 'PUT', `/v1/stores/${shop.storeId}/payment-methods/cod`, { enabled: true });
  await apiCall(shop.token, 'POST', `/v1/stores/${shop.storeId}/delivery-zones`, { nameAr: 'حولي', nameEn: 'Hawalli', fee: 1500 });
  await apiCall(shop.token, 'PUT', `/v1/stores/${shop.storeId}/checkout-settings`, { pickupEnabled: true });
  await page.close();
});

for (const themeId of THEMES) {
  test(`theme ${themeId}: every page renders in Arabic and English and fits the screen`, async ({ page }, info) => {
    await apiCall(shop.token, 'POST', `/v1/stores/${shop.storeId}/theme/publish`, { themeId });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    for (const locale of ['ar', 'en'] as const) {
      for (const path of ['', '/products', '/c/perfume', '/p/rose-perfume', '/p/oud-oil', '/cart']) {
        const res = await page.goto(shopUrl(shop.slug, `/${locale}${path}`));
        expect(res?.status(), path).toBe(200);
        await expect(page.locator('[data-theme]')).toHaveAttribute('data-theme', themeId);
        await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
        await expect(page.getByRole('heading', { level: 1 }), `${path} has one h1`).toHaveCount(1);
        expect(await pageWidth(page), `${themeId} ${locale}${path} width`).toBeLessThanOrEqual(page.viewportSize()!.width);
        // Header essentials exist in every theme.
        await expect(page.getByTestId('cart-count')).toBeVisible();
        await expect(page.getByRole('searchbox')).toHaveCount(1);
        // Every image is described.
        expect(await page.locator('img:not([alt])').count(), `${path} images have alt`).toBe(0);
        if (path === '' || path === '/products' || path === '/c/perfume') {
          await expect(page.getByRole('link', { name: locale === 'ar' ? 'عطر الورد' : 'Rose Perfume' }).first()).toBeVisible();
        }
        if (process.env.SHOT_DIR) {
          await page.screenshot({ path: `${process.env.SHOT_DIR}/${themeId}-${info.project.name}-${locale}${path.replaceAll('/', '_') || '_home'}.png`, fullPage: true });
        }
      }
    }

    // The buy flow works in this theme's markup.
    await page.goto(shopUrl(shop.slug, '/ar/p/oud-oil'));
    await page.getByRole('button', { name: '3ml' }).click();
    await page.getByRole('button', { name: 'أضف إلى السلة' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'تمت الإضافة' })).toBeVisible();
    await expect(page.getByTestId('cart-count')).toHaveText('1');
    await page.goto(shopUrl(shop.slug, '/ar/cart'));
    await expect(page.getByTestId('cart-line')).toHaveCount(1);
    expect(await pageWidth(page)).toBeLessThanOrEqual(page.viewportSize()!.width);

    // Checkout and the order page work and fit in this theme too.
    const shot = async (name: string) => {
      if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${themeId}-${info.project.name}-ar_${name}.png`, fullPage: true });
    };
    await page.getByTestId('checkout-link').click();
    await expect(page.locator('[data-theme]')).toHaveAttribute('data-theme', themeId);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('إتمام الطلب');
    await page.getByLabel('منطقة التوصيل').selectOption({ label: 'حولي' });
    await expect(page.getByTestId('summary-total')).toContainText('9.500');
    await page.getByLabel('الاسم الكامل').fill('سارة أحمد');
    await page.getByLabel('رقم الهاتف').fill('50001234');
    await page.getByLabel('المنطقة', { exact: true }).fill('السالمية');
    await page.getByLabel('القطعة').fill('10');
    await page.getByLabel('الشارع').fill('شارع سالم المبارك');
    await page.getByLabel('المنزل / المبنى').fill('15');
    expect(await pageWidth(page), `${themeId} checkout width`).toBeLessThanOrEqual(page.viewportSize()!.width);
    await shot('checkout');
    await page.getByRole('button', { name: 'تأكيد الطلب' }).click();
    await expect(page).toHaveURL(/\/ar\/orders\//);
    await expect(page.locator('[data-theme]')).toHaveAttribute('data-theme', themeId);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('تم استلام طلبك');
    await expect(page.getByTestId('order-total')).toContainText('9.500');
    expect(await pageWidth(page), `${themeId} order width`).toBeLessThanOrEqual(page.viewportSize()!.width);
    await shot('order');

    expect(errors, 'no script or console errors').toEqual([]);
  });
}

test('the five themes are different designs, not one layout recoloured', async ({ page }) => {
  const seen: { font: string; bg: string; radius: string; h1Size: string }[] = [];
  for (const themeId of THEMES) {
    await apiCall(shop.token, 'POST', `/v1/stores/${shop.storeId}/theme/publish`, { themeId });
    await page.goto(shopUrl(shop.slug, '/ar/p/rose-perfume'));
    seen.push(await page.evaluate(() => {
      const root = document.querySelector('[data-theme]')!;
      const btn = document.querySelector('button[type=submit]')!;
      return {
        font: getComputedStyle(root).fontFamily.split(',')[0]!, bg: getComputedStyle(root).backgroundColor,
        radius: getComputedStyle(btn).borderRadius, h1Size: getComputedStyle(document.querySelector('h1')!).fontFamily.split(',')[0]!,
      };
    }));
  }
  expect(new Set(seen.map((s) => s.bg)).size).toBeGreaterThanOrEqual(4);
  expect(new Set(seen.map((s) => `${s.font}|${s.h1Size}`)).size).toBe(5);
  expect(new Set(seen.map((s) => s.radius)).size).toBeGreaterThanOrEqual(3);
});

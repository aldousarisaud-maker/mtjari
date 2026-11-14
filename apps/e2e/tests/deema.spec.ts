import { expect, test, type Page } from '@playwright/test';
import { apiCall, login, seedShop, shopUrl, type SeededShop } from './helpers';

/**
 * Online payment with Deema in the browser, against the local stand-in (fake-deema.mjs):
 * the merchant enters their own four keys and picks the environment, a shopper pays or fails
 * to pay, and the order page and dashboard show what really happened.
 */
const SLUG = 'dm-shop';
const owner = 'dm.owner@example.com';
const KEY = 'FakeDeemaApiKeyForTestsAAAA0001';
let shop: SeededShop;
const dash = (path = '') => `/ar/dashboard/${shop.storeId}${path}`;
const shot = async (page: Page, name: string) => { if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/deema-${name}.png`, fullPage: true }); };

async function checkoutWithDeema(page: Page) {
  await page.goto(shopUrl(SLUG, '/ar/p/oud-oil'));
  await page.getByRole('button', { name: '3ml' }).click();
  await page.getByRole('button', { name: 'أضف إلى السلة' }).click();
  await expect(page.getByRole('status')).toBeVisible();
  await page.goto(shopUrl(SLUG, '/ar/checkout'));
  await page.getByLabel('منطقة التوصيل').selectOption({ label: 'حولي' });
  await page.getByLabel('الاسم الكامل').fill('سارة أحمد');
  await page.getByLabel('رقم الهاتف').fill('50001234');
  await page.getByLabel('المنطقة', { exact: true }).fill('السالمية');
  await page.getByLabel('القطعة').fill('10');
  await page.getByLabel('الشارع').fill('شارع سالم المبارك');
  await page.getByLabel('المنزل / المبنى').fill('15');
  await page.getByRole('radio', { name: /ديما/ }).check();
  await page.getByRole('button', { name: 'تأكيد الطلب' }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:2531\/pay\?order_reference=/);
  await expect(page.getByTestId('amount')).toHaveText('9.500 KWD');
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  shop = await seedShop(page, owner, SLUG, 'متجر ديما');
  const base = `/v1/stores/${shop.storeId}`;
  await apiCall(shop.token, 'POST', `${base}/theme/publish`, { themeId: 'gulf-premium' });
  await apiCall(shop.token, 'POST', `${base}/launch`);
  await apiCall(shop.token, 'POST', `${base}/delivery-zones`, { nameAr: 'حولي', nameEn: 'Hawalli', fee: 1500 });
  await apiCall(shop.token, 'PUT', `${base}/payment-methods/cod`, { enabled: true });
  await page.close();
});

test('the merchant enters their own Deema key and sees the address to enter in Deema', async ({ page }) => {
  await login(page, owner);
  await page.goto(dash('/delivery'));
  const dm = page.getByTestId('method-deema');
  await expect(dm).toContainText('بانتظار الإعداد');
  await expect(dm).toContainText('Merchant Portal');
  await expect(page.getByTestId('webhook-url-deema')).toContainText(`/v1/webhooks/payments/deema/${shop.storeId}`);
  await shot(page, 'settings-pending');

  const fill = async (key: string) => {
    await dm.locator('input[type="password"]').fill(key);
    await dm.getByLabel('البيئة').selectOption({ label: 'تجريبية (Sandbox)' });
  };
  await fill('WrongDeemaApiKeyForTestsAAAA01');
  await dm.getByRole('button', { name: 'تفعيل' }).click();
  await expect(dm.getByRole('alert')).toContainText('المفتاح غير صحيح');
  await expect(dm).toContainText('بانتظار الإعداد');

  await fill(KEY);
  await dm.getByRole('button', { name: 'تفعيل' }).click();
  await expect(dm).toContainText('مفعّلة');
  await expect(page.getByTestId('mode-deema')).toHaveText('وضع الاختبار');
  await page.reload();
  expect(await page.content()).not.toContain(KEY);
  await shot(page, 'settings-enabled');
});

test('a shopper pays with Deema and comes back to a paid, confirmed order', async ({ page }) => {
  await checkoutWithDeema(page);
  await page.getByRole('button', { name: 'Pay', exact: true }).click();

  await expect(page).toHaveURL(/\/ar\/orders\/[A-Za-z0-9_-]{43}$/);
  await expect(page.getByTestId('paid-note')).toContainText('تم استلام الدفع');
  await expect(page.getByTestId('order-payment')).toContainText('ديما');
  await expect(page.getByTestId('order-payment')).toContainText('مدفوع');
  await expect(page.getByTestId('order-status')).toHaveText('مؤكد');
  await shot(page, 'order-paid');

  await login(page, owner);
  await page.goto(dash('/orders'));
  await page.getByTestId('order-row').first().getByRole('link').first().click();
  await expect(page.getByTestId('payment-status')).toHaveText('مدفوع');
  await expect(page.getByTestId('order-event').filter({ hasText: 'تم تأكيد الدفع من مزود الدفع' })).toHaveCount(1);
});

test('a failed payment leaves the order unpaid; the shopper tries again and pays', async ({ page }) => {
  await checkoutWithDeema(page);
  await page.getByRole('button', { name: 'Decline' }).click();

  await expect(page).toHaveURL(/\/ar\/orders\/[A-Za-z0-9_-]{43}$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('طلبك بانتظار الدفع');
  await expect(page.getByTestId('pay-box').getByRole('alert')).toContainText('لم تنجح عملية الدفع');

  await page.getByRole('button', { name: /حاول الدفع مرة أخرى/ }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:2531\/pay\?order_reference=/);
  await page.getByRole('button', { name: 'Pay', exact: true }).click();
  await expect(page.getByTestId('paid-note')).toBeVisible();
  await expect(page.getByTestId('order-status')).toHaveText('مؤكد');
});

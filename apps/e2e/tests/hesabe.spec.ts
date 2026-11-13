import { expect, test, type Page } from '@playwright/test';
import { apiCall, login, seedShop, shopUrl, type SeededShop } from './helpers';

/**
 * Online payment with Hesabe in the browser, against the local stand-in (fake-hesabe.mjs):
 * the merchant enters their own four keys and picks the environment, a shopper pays or fails
 * to pay, and the order page and dashboard show what really happened.
 */
const SLUG = 'hs-shop';
const owner = 'hs.owner@example.com';
const KEYS = { merchantCode: '1000001', accessCode: 'aaaaaaaa-0000-4000-8000-000000000001', secretKey: 'FakeHesabeSecretKeyForTestsAAA01', ivKey: 'FakeHesabeIvA001' };
let shop: SeededShop;
const dash = (path = '') => `/ar/dashboard/${shop.storeId}${path}`;
const shot = async (page: Page, name: string) => { if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/hesabe-${name}.png`, fullPage: true }); };

async function checkoutWithHesabe(page: Page) {
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
  await page.getByRole('radio', { name: /حسابي/ }).check();
  await page.getByRole('button', { name: 'تأكيد الطلب' }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:2529\/payment\?data=/);
  await expect(page.getByTestId('amount')).toHaveText('9.500 KWD');
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  shop = await seedShop(page, owner, SLUG, 'متجر حسابي');
  const base = `/v1/stores/${shop.storeId}`;
  await apiCall(shop.token, 'POST', `${base}/theme/publish`, { themeId: 'gulf-premium' });
  await apiCall(shop.token, 'POST', `${base}/launch`);
  await apiCall(shop.token, 'POST', `${base}/delivery-zones`, { nameAr: 'حولي', nameEn: 'Hawalli', fee: 1500 });
  await apiCall(shop.token, 'PUT', `${base}/payment-methods/cod`, { enabled: true });
  await page.close();
});

test('the merchant enters their own four Hesabe keys', async ({ page }) => {
  await login(page, owner);
  await page.goto(dash('/delivery'));
  const hs = page.getByTestId('method-hesabe');
  await expect(hs).toContainText('بانتظار الإعداد');
  await expect(hs).toContainText('مفتاح التشفير');
  await shot(page, 'settings-pending');

  const fill = async (c: typeof KEYS) => {
    const inputs = hs.locator('input[type="password"], input[type="text"]');
    await expect(inputs).toHaveCount(4);
    for (const [i, v] of [c.merchantCode, c.accessCode, c.secretKey, c.ivKey].entries()) await inputs.nth(i).fill(v);
    await hs.getByLabel('البيئة').selectOption({ label: 'تجريبية (Sandbox)' });
  };
  // Keys that look right but Hesabe cannot read (wrong secret).
  await fill({ ...KEYS, secretKey: 'FakeHesabeSecretKeyForTestsBBB02' });
  await hs.getByRole('button', { name: 'تفعيل' }).click();
  await expect(hs.getByRole('alert')).toContainText('المفتاح غير صحيح');
  await expect(hs).toContainText('بانتظار الإعداد');

  await fill(KEYS);
  await hs.getByRole('button', { name: 'تفعيل' }).click();
  await expect(hs).toContainText('مفعّلة');
  await expect(page.getByTestId('mode-hesabe')).toHaveText('وضع الاختبار');
  await page.reload();
  const html = await page.content();
  for (const secret of [KEYS.accessCode, KEYS.secretKey, KEYS.ivKey]) expect(html).not.toContain(secret);
  await shot(page, 'settings-enabled');
});

test('a shopper pays with Hesabe and comes back to a paid, confirmed order', async ({ page }) => {
  await checkoutWithHesabe(page);
  await page.getByRole('button', { name: 'Pay', exact: true }).click();

  await expect(page).toHaveURL(/\/ar\/orders\/[A-Za-z0-9_-]{43}$/);
  await expect(page.getByTestId('paid-note')).toContainText('تم استلام الدفع');
  await expect(page.getByTestId('order-payment')).toContainText('حسابي');
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
  await checkoutWithHesabe(page);
  await page.getByRole('button', { name: 'Decline' }).click();

  await expect(page).toHaveURL(/\/ar\/orders\/[A-Za-z0-9_-]{43}$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('طلبك بانتظار الدفع');
  await expect(page.getByTestId('pay-box').getByRole('alert')).toContainText('لم تنجح عملية الدفع');

  await page.getByRole('button', { name: /حاول الدفع مرة أخرى/ }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:2529\/payment\?data=/);
  await page.getByRole('button', { name: 'Pay', exact: true }).click();
  await expect(page.getByTestId('paid-note')).toBeVisible();
  await expect(page.getByTestId('order-status')).toHaveText('مؤكد');
});

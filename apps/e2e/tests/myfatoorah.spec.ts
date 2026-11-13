import { expect, test, type Page } from '@playwright/test';
import { apiCall, login, seedShop, shopUrl, type SeededShop } from './helpers';

/**
 * Online payment with MyFatoorah in the browser, against the local stand-in
 * (fake-myfatoorah.mjs): the merchant pastes their own API token and picks the
 * account country, a shopper pays or fails to pay, and the order page and
 * dashboard show what really happened.
 */
const SLUG = 'mf-shop';
const owner = 'mf.owner@example.com';
const TOKEN = 'FakeMyFatoorahToken_0000000001';
let shop: SeededShop;
const dash = (path = '') => `/ar/dashboard/${shop.storeId}${path}`;
const shot = async (page: Page, name: string) => { if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/myfatoorah-${name}.png`, fullPage: true }); };

async function checkoutWithMyFatoorah(page: Page) {
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
  await page.getByRole('radio', { name: /ماي فاتورة/ }).check();
  await page.getByRole('button', { name: 'تأكيد الطلب' }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:2528\/pay\/\d+/);
  await expect(page.getByTestId('amount')).toHaveText('9.500 KWD');
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  shop = await seedShop(page, owner, SLUG, 'متجر ماي فاتورة');
  const base = `/v1/stores/${shop.storeId}`;
  await apiCall(shop.token, 'POST', `${base}/theme/publish`, { themeId: 'gulf-premium' });
  await apiCall(shop.token, 'POST', `${base}/launch`);
  await apiCall(shop.token, 'POST', `${base}/delivery-zones`, { nameAr: 'حولي', nameEn: 'Hawalli', fee: 1500 });
  await apiCall(shop.token, 'PUT', `${base}/payment-methods/cod`, { enabled: true });
  await page.close();
});

test('the merchant enters their own MyFatoorah token and account country', async ({ page }) => {
  await login(page, owner);
  await page.goto(dash('/delivery'));
  const mf = page.getByTestId('method-myfatoorah');
  await expect(mf).toContainText('بانتظار الإعداد');
  await expect(mf).toContainText('Integration Settings');
  await shot(page, 'settings-pending');

  // A Saudi account invoices in SAR; this store sells in KWD.
  await mf.getByLabel('مفتاح الربط').fill(TOKEN);
  await mf.getByLabel('بلد حساب ماي فاتورة').selectOption({ label: 'السعودية' });
  await mf.getByRole('button', { name: 'تفعيل' }).click();
  await expect(mf.getByRole('alert')).toContainText('تختلف عن عملة المتجر');

  // A token MyFatoorah does not accept.
  await mf.getByLabel('مفتاح الربط').fill('WrongMyFatoorahToken_000000001');
  await mf.getByLabel('بلد حساب ماي فاتورة').selectOption({ label: 'الكويت' });
  await mf.getByRole('button', { name: 'تفعيل' }).click();
  await expect(mf.getByRole('alert')).toContainText('المفتاح غير صحيح');
  await expect(mf).toContainText('بانتظار الإعداد');

  await mf.getByLabel('مفتاح الربط').fill(TOKEN);
  await mf.getByLabel('بلد حساب ماي فاتورة').selectOption({ label: 'الكويت' });
  await mf.getByRole('button', { name: 'تفعيل' }).click();
  await expect(mf).toContainText('مفعّلة');
  await expect(page.getByTestId('mode-myfatoorah')).toHaveText('وضع مباشر');
  await page.reload();
  expect(await page.content()).not.toContain(TOKEN);
  await shot(page, 'settings-enabled');
});

test('a shopper pays with MyFatoorah and comes back to a paid, confirmed order', async ({ page }) => {
  await checkoutWithMyFatoorah(page);
  await page.getByRole('button', { name: 'Pay', exact: true }).click();

  await expect(page).toHaveURL(/\/ar\/orders\/[A-Za-z0-9_-]{43}$/);
  await expect(page.getByTestId('paid-note')).toContainText('تم استلام الدفع');
  await expect(page.getByTestId('order-payment')).toContainText('ماي فاتورة');
  await expect(page.getByTestId('order-payment')).toContainText('مدفوع');
  await expect(page.getByTestId('order-status')).toHaveText('مؤكد');

  await login(page, owner);
  await page.goto(dash('/orders'));
  await page.getByTestId('order-row').first().getByRole('link').first().click();
  await expect(page.getByTestId('payment-status')).toHaveText('مدفوع');
  await expect(page.getByTestId('order-event').filter({ hasText: 'تم تأكيد الدفع من مزود الدفع' })).toHaveCount(1);
});

test('a failed payment leaves the order unpaid; the shopper tries again and pays', async ({ page }) => {
  await checkoutWithMyFatoorah(page);
  await page.getByRole('button', { name: 'Decline' }).click();

  await expect(page).toHaveURL(/\/ar\/orders\/[A-Za-z0-9_-]{43}$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('طلبك بانتظار الدفع');
  await expect(page.getByTestId('pay-box').getByRole('alert')).toContainText('لم تنجح عملية الدفع');

  await page.getByRole('button', { name: /حاول الدفع مرة أخرى/ }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:2528\/pay\/\d+/);
  await page.getByRole('button', { name: 'Pay', exact: true }).click();
  await expect(page.getByTestId('paid-note')).toBeVisible();
  await expect(page.getByTestId('order-status')).toHaveText('مؤكد');
});

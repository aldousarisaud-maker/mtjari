import { expect, test, type Page } from '@playwright/test';
import { apiCall, login, seedShop, shopUrl, type SeededShop } from './helpers';

/**
 * Online payment with Tap, end to end in the browser, against the local
 * stand-in for Tap (fake-tap.mjs): the merchant pastes their own secret key,
 * a shopper pays, declines or abandons the payment page, and the order page
 * and dashboard show what really happened.
 */
const SLUG = 'tap-shop';
const owner = 'tap.owner@example.com';
const KEY = 'sk_test_FakeTapKey00000001';
let shop: SeededShop;
const dash = (path = '') => `/ar/dashboard/${shop.storeId}${path}`;
// Optional: SHOT_DIR=/some/folder saves pictures for visual review.
const shot = async (page: Page, name: string) => { if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/tap-${name}.png`, fullPage: true }); };

async function checkoutWithTap(page: Page) {
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
  await page.getByRole('radio', { name: /الدفع الإلكتروني/ }).check();
  await page.getByRole('button', { name: 'تأكيد الطلب' }).click();
  // The shopper is now on the provider's page, not ours.
  await expect(page).toHaveURL(/127\.0\.0\.1:2527\/pay\/chg_/);
  await expect(page.getByTestId('amount')).toHaveText('9.500 KWD');
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  shop = await seedShop(page, owner, SLUG, 'متجر تاب');
  const base = `/v1/stores/${shop.storeId}`;
  await apiCall(shop.token, 'POST', `${base}/theme/publish`, { themeId: 'gulf-premium' });
  await apiCall(shop.token, 'POST', `${base}/launch`);
  await apiCall(shop.token, 'POST', `${base}/delivery-zones`, { nameAr: 'حولي', nameEn: 'Hawalli', fee: 1500 });
  await apiCall(shop.token, 'PUT', `${base}/payment-methods/cod`, { enabled: true });
  await page.close();
});

test('the merchant enters their own Tap secret key in the store settings', async ({ page }) => {
  // Before a key is entered, shoppers are not offered online payment.
  await page.goto(shopUrl(SLUG, '/ar/p/oud-oil'));
  await page.getByRole('button', { name: '3ml' }).click();
  await page.getByRole('button', { name: 'أضف إلى السلة' }).click();
  await expect(page.getByRole('status')).toBeVisible();
  await page.goto(shopUrl(SLUG, '/ar/checkout'));
  await expect(page.getByRole('radio', { name: 'الدفع عند الاستلام' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /الدفع الإلكتروني/ })).toHaveCount(0);

  await login(page, owner);
  await page.goto(dash('/delivery'));
  const tap = page.getByTestId('method-tap');
  await expect(tap).toContainText('بانتظار الإعداد');
  await expect(tap).toContainText('API Credentials');
  await shot(page, 'settings-pending');

  // A key Tap does not accept is refused with a clear message, and nothing is switched on.
  await tap.getByLabel('المفتاح السري').fill('sk_test_NotARealKey0000001');
  await tap.getByRole('button', { name: 'تفعيل' }).click();
  await expect(tap.getByRole('alert')).toContainText('المفتاح غير صحيح');
  await expect(tap).toContainText('بانتظار الإعداد');

  await tap.getByLabel('المفتاح السري').fill(KEY);
  await tap.getByRole('button', { name: 'تفعيل' }).click();
  await expect(tap).toContainText('مفعّلة');
  await expect(page.getByTestId('mode-tap')).toHaveText('وضع الاختبار');
  // Write-only: the key is nowhere in the page afterwards.
  await page.reload();
  await expect(page.getByTestId('mode-tap')).toHaveText('وضع الاختبار');
  expect(await page.content()).not.toContain(KEY);
  await shot(page, 'settings-enabled');
});

test('a shopper pays online and comes back to a paid, confirmed order', async ({ page }) => {
  await checkoutWithTap(page);
  await page.getByRole('button', { name: 'Pay', exact: true }).click();

  // Back on the shop: the payment reference is gone from the address and the order is paid.
  await expect(page).toHaveURL(/\/ar\/orders\/[A-Za-z0-9_-]{43}$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('تم استلام طلبك');
  await expect(page.getByTestId('paid-note')).toContainText('تم استلام الدفع');
  await expect(page.getByTestId('order-payment')).toContainText('مدفوع');
  await expect(page.getByTestId('order-status')).toHaveText('مؤكد');
  await expect(page.getByTestId('pay-box')).toHaveCount(0);
  await shot(page, 'order-paid');

  // The merchant sees it paid by the provider, with no button to record cash.
  await login(page, owner);
  await page.goto(dash('/orders'));
  const row = page.getByTestId('order-row').first();
  await expect(row).toContainText('مدفوع');
  await row.getByRole('link').first().click();
  await expect(page.getByTestId('payment-status')).toHaveText('مدفوع');
  await expect(page.getByTestId('order-event').filter({ hasText: 'تم تأكيد الدفع من مزود الدفع' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /تسجيل استلام المبلغ/ })).toHaveCount(0);
});

test('a declined payment leaves the order unpaid; the shopper tries again and pays', async ({ page }) => {
  await checkoutWithTap(page);
  await page.getByRole('button', { name: 'Decline' }).click();

  await expect(page).toHaveURL(/\/ar\/orders\/[A-Za-z0-9_-]{43}$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('طلبك بانتظار الدفع');
  await expect(page.getByTestId('pay-box').getByRole('alert')).toContainText('لم تنجح عملية الدفع');
  await expect(page.getByTestId('order-payment')).toContainText('غير مدفوع');
  await shot(page, 'order-payment-failed');

  await page.getByRole('button', { name: /حاول الدفع مرة أخرى/ }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:2527\/pay\/chg_/);
  await page.getByRole('button', { name: 'Pay', exact: true }).click();
  await expect(page.getByTestId('paid-note')).toBeVisible();
  await expect(page.getByTestId('order-status')).toHaveText('مؤكد');
});

test('leaving the payment page keeps the order waiting, with a way to pay later', async ({ page }) => {
  await checkoutWithTap(page);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('طلبك بانتظار الدفع');
  const orderUrl = page.url();

  // Adding a made-up payment reference to the address proves nothing.
  await page.goto(`${orderUrl}?tap_id=chg_TSmadeUpReference0001`);
  await expect(page).toHaveURL(orderUrl);
  await expect(page.getByTestId('order-payment')).toContainText('غير مدفوع');
  await expect(page.getByRole('button', { name: /حاول الدفع مرة أخرى|ادفع الآن/ })).toBeVisible();

  // The merchant sees an unpaid order and cannot mark it paid by hand.
  await login(page, owner);
  await page.goto(dash('/orders'));
  await page.getByTestId('order-row').first().getByRole('link').first().click();
  await expect(page.getByTestId('payment-status')).toHaveText('غير مدفوع');
  await expect(page.getByRole('button', { name: /تسجيل استلام المبلغ/ })).toHaveCount(0);
});

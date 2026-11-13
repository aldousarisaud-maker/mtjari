import { expect, test, type Page } from '@playwright/test';
import { apiCall, login, seedShop, shopGet, shopUrl, type SeededShop } from './helpers';

/**
 * The whole purchase: the merchant sets up delivery and payment, a shopper
 * orders with cash on delivery, the merchant works the order to "delivered"
 * and records the cash; a second order is picked up and cancelled.
 */
const SLUG = 'co-shop';
const owner = 'checkout.owner@example.com';
const SECRET = 'whsec_browser_test_secret';
let shop: SeededShop;
let orderUrl = '';
const dash = (path = '') => `/ar/dashboard/${shop.storeId}${path}`;

async function sinkMail(to: string, contains = ''): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const mail = (await (await fetch(`http://127.0.0.1:2526/?to=${encodeURIComponent(to)}`)).json()) as { body: string } | null;
    if (mail && mail.body.includes(contains)) return mail.body;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no mail for ${to} containing "${contains}"`);
}
const stockOf = async (sku: string) =>
  (await apiCall<{ items: { sku: string; stockQuantity: number }[] }>(shop.token, 'GET', `/v1/stores/${shop.storeId}/inventory?q=${sku}`)).items.find((i) => i.sku === sku)!.stockQuantity;

async function addToCart(page: Page, locale: 'ar' | 'en', slug: string, size?: string, quantity?: string) {
  await page.goto(shopUrl(SLUG, `/${locale}/p/${slug}`));
  if (size) await page.getByRole('button', { name: size }).click();
  if (quantity) await page.getByLabel(locale === 'ar' ? 'الكمية' : 'Quantity').selectOption(quantity);
  await page.getByRole('button', { name: locale === 'ar' ? 'أضف إلى السلة' : 'Add to cart' }).click();
  await expect(page.getByRole('status')).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  shop = await seedShop(page, owner, SLUG, 'متجر الطلبات');
  await apiCall(shop.token, 'POST', `/v1/stores/${shop.storeId}/theme/publish`, { themeId: 'gulf-premium' });
  await apiCall(shop.token, 'POST', `/v1/stores/${shop.storeId}/launch`);
  await page.close();
});

test('a launched store without payment or delivery set up offers no checkout', async ({ page }) => {
  await addToCart(page, 'ar', 'oud-oil', '3ml');
  await page.goto(shopUrl(SLUG, '/ar/cart'));
  await expect(page.getByTestId('checkout-note')).toContainText('غير مفعّلين');
  await expect(page.getByTestId('checkout-link')).toHaveCount(0);
  // Opening the checkout address directly says the same, with no form.
  await page.goto(shopUrl(SLUG, '/ar/checkout'));
  await expect(page.getByRole('alert').filter({ hasText: 'لا يستقبل الطلبات' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'تأكيد الطلب' })).toHaveCount(0);
});

test('merchant sets up delivery zones, pickup and payment methods', async ({ page }) => {
  await login(page, owner);
  await page.goto(dash());
  await page.getByRole('link', { name: 'التوصيل والدفع' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('التوصيل والدفع');
  const ready = page.getByTestId('checkout-readiness');
  await expect(ready).toContainText('فعّل طريقة دفع واحدة على الأقل');
  await expect(ready).toContainText('أضف منطقة توصيل');

  // Kuwait governorates in one step.
  await page.getByLabel('رسوم التوصيل لكل محافظة').fill('1.500');
  await page.getByRole('button', { name: 'إضافة محافظات الكويت الست' }).click();
  await expect(page.getByTestId('zone-row')).toHaveCount(6);
  await expect(page.getByTestId('zone-row').first().getByLabel('رسوم التوصيل')).toHaveValue('1.500');

  // Edit one zone: cheaper, free from 20 KWD.
  const capital = page.getByTestId('zone-row').filter({ has: page.locator('input[value="Capital"]') });
  await capital.getByLabel('رسوم التوصيل').fill('1');
  await capital.getByLabel('توصيل مجاني من مبلغ').fill('20');
  await capital.getByRole('button', { name: 'حفظ' }).click();
  await expect(capital.getByRole('status')).toContainText('تم حفظ المنطقة');

  // A bad amount is refused and the typed value stays.
  await page.getByLabel('الاسم (عربي)').last().fill('الوفرة');
  await page.getByLabel('الاسم (إنجليزي)').last().fill('Wafra');
  await page.locator('#new-zone-fee').fill('abc');
  await page.getByRole('button', { name: 'إضافة منطقة' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'المبلغ غير صحيح' })).toBeVisible();
  await expect(page.locator('#new-zone-en')).toHaveValue('Wafra');
  await page.locator('#new-zone-fee').fill('5');
  await page.getByRole('button', { name: 'إضافة منطقة' }).click();
  await expect(page.getByTestId('zone-row')).toHaveCount(7);
  // ...and can be deleted again.
  await page.getByTestId('zone-row').filter({ has: page.locator('input[value="Wafra"]') }).getByRole('button', { name: 'حذف' }).click();
  await expect(page.getByTestId('zone-row')).toHaveCount(6);

  // Pickup and a minimum order.
  await page.getByLabel('السماح بالاستلام من المتجر').check();
  await page.getByLabel('تعليمات الاستلام (عربي)').fill('الاستلام من فرع السالمية من 10 صباحاً');
  await page.getByLabel('تعليمات الاستلام (إنجليزي)').fill('Collect from the Salmiya branch from 10 am');
  await page.getByLabel('الحد الأدنى للطلب').fill('3');
  await page.getByRole('button', { name: 'حفظ الخيارات' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'تم حفظ الخيارات' })).toBeVisible();

  // Cash on delivery needs nothing; one click.
  const cod = page.getByTestId('method-cod');
  await cod.getByRole('button', { name: 'تفعيل' }).click();
  await expect(cod).toContainText('مفعّلة');
  await expect(ready).toContainText('جاهز لاستقبال الطلبات');

  // A provider that needs credentials shows "pending configuration" until they are entered.
  const gateway = page.getByTestId('method-testpay');
  await expect(gateway).toContainText('بانتظار الإعداد');
  await gateway.getByLabel('مفتاح التوقيع').fill(SECRET);
  await gateway.getByRole('button', { name: 'تفعيل' }).click();
  await expect(gateway).toContainText('مفعّلة');
  // The secret is write-only: it is nowhere in the page after saving.
  await page.reload();
  expect(await page.content()).not.toContain(SECRET);
  await gateway.getByRole('button', { name: 'إيقاف' }).click();
  await expect(gateway).toContainText('متوقفة');
  await expect(gateway.getByText('محفوظة ومشفّرة')).toBeVisible();
  expect(await page.content()).not.toContain(SECRET);
});

test('a shopper checks out with cash on delivery', async ({ page }) => {
  await addToCart(page, 'ar', 'oud-oil', '3ml', '2');
  await page.goto(shopUrl(SLUG, '/ar/cart'));
  await page.getByTestId('checkout-link').click();
  await expect(page).toHaveURL(/\/ar\/checkout$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('إتمام الطلب');
  await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', /noindex/);

  await expect(page.getByTestId('summary-subtotal')).toContainText('16.000');
  await expect(page.getByTestId('summary-delivery')).toHaveText('تُحسب بعد اختيار المنطقة');
  // The fee follows the area; the free-delivery threshold of the Capital zone is not reached.
  await page.getByLabel('منطقة التوصيل').selectOption({ label: 'العاصمة' });
  await expect(page.getByTestId('summary-delivery')).toContainText('1.000');
  await page.getByLabel('منطقة التوصيل').selectOption({ label: 'حولي' });
  await expect(page.getByTestId('summary-delivery')).toContainText('1.500');
  await expect(page.getByTestId('summary-total')).toContainText('17.500');
  // Only the method the merchant switched on is offered.
  await expect(page.getByRole('radio', { name: 'الدفع عند الاستلام' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'بوابة اختبار' })).toHaveCount(0);

  await page.getByLabel('الاسم الكامل').fill('سارة أحمد');
  await page.getByLabel('رقم الهاتف').fill('123');
  await page.getByLabel('البريد الإلكتروني').fill('sara.shopper@example.com');
  await page.getByLabel('المنطقة', { exact: true }).fill('السالمية');
  await page.getByLabel('القطعة').fill('10');
  await page.getByLabel('الشارع').fill('شارع سالم المبارك');
  await page.getByLabel('المنزل / المبنى').fill('15');
  await page.getByLabel('ملاحظات على الطلب').fill('الاتصال قبل الوصول');

  // A wrong phone number is refused and nothing typed is lost.
  await page.getByRole('button', { name: 'تأكيد الطلب' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'رقم الهاتف غير صحيح' })).toBeVisible();
  await expect(page.getByLabel('الشارع')).toHaveValue('شارع سالم المبارك');
  await expect(page.getByLabel('منطقة التوصيل')).toHaveValue(/.+/);

  await page.getByLabel('رقم الهاتف').fill('5000 1234');
  await page.getByRole('button', { name: 'تأكيد الطلب' }).click();

  await expect(page).toHaveURL(/\/ar\/orders\/[A-Za-z0-9_-]{43}$/);
  orderUrl = page.url();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('تم استلام طلبك');
  await expect(page.getByTestId('order-number')).toHaveText('1001');
  await expect(page.getByTestId('order-line')).toContainText('دهن العود (3ml) × 2');
  await expect(page.getByTestId('order-delivery')).toContainText('1.500');
  await expect(page.getByTestId('order-total')).toContainText('17.500');
  await expect(page.getByTestId('order-status')).toHaveText('بانتظار التأكيد');
  await expect(page.getByTestId('order-payment')).toHaveText('الدفع عند الاستلام · غير مدفوع');
  await expect(page.getByTestId('order-address')).toContainText('حولي');
  await expect(page.getByTestId('order-address')).toContainText('السالمية');
  await expect(page.getByText('+96550001234')).toBeVisible();
  // The order link is private.
  await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', /noindex/);
  await expect(page.locator('meta[name=referrer]')).toHaveAttribute('content', 'no-referrer');
  // The cart is empty and stock was taken.
  await expect(page.getByTestId('cart-count')).toHaveText('0');
  expect(await stockOf(`${SLUG}-OUD3`)).toBe(3);

  // Confirmation email to the shopper, notification to the merchant.
  const mail = await sinkMail('sara.shopper@example.com', '1001');
  expect(mail).toContain('1001');
  expect(mail).toContain(orderUrl);
  expect(await sinkMail(owner, `/dashboard/${shop.storeId}/orders/`)).toContain('1001');
});

test('the order link is private to its shop and unguessable', async ({ page, browser }) => {
  const token = orderUrl.split('/').pop()!;
  // A stranger with no cookies can open it only with the full token.
  const stranger = await (await browser.newContext()).newPage();
  expect((await stranger.goto(orderUrl))?.status()).toBe(200);
  expect((await stranger.goto(shopUrl(SLUG, `/ar/orders/${token.slice(0, -1)}A`)))?.status()).toBe(404);
  expect((await stranger.goto(shopUrl(SLUG, '/ar/orders/1001')))?.status()).toBe(404);
  await stranger.close();
  expect((await shopGet(page, shopUrl(SLUG, '/robots.txt'))).text()).resolves.toContain('Disallow: /ar/orders/');
});

test('merchant works the order: confirm, prepare, deliver, record the cash', async ({ page }) => {
  await login(page, owner);
  await page.goto(dash());
  await page.getByRole('link', { name: 'الطلبات' }).click();
  const row = page.getByTestId('order-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('#1001');
  await expect(row).toContainText('سارة أحمد');
  await expect(row).toContainText('17.500');
  await expect(row).toContainText('بانتظار التأكيد');
  await expect(row).toContainText('غير مدفوع');

  // Search finds it by phone; a status with no orders is empty.
  await page.getByRole('searchbox').fill('50001234');
  await page.getByRole('button', { name: 'تصفية' }).click();
  await expect(row).toHaveCount(1);
  await page.getByRole('link', { name: /^تم التسليم/ }).click();
  await expect(page.getByText('لا توجد طلبات مطابقة')).toBeVisible();
  await page.getByRole('link', { name: /^الكل/ }).click();

  await row.getByRole('link', { name: '#1001' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('1001');
  await expect(page.getByTestId('order-item')).toContainText('دهن العود');
  await expect(page.getByTestId('order-item')).toContainText('3ml');
  await expect(page.getByTestId('order-total')).toContainText('17.500');
  await expect(page.getByTestId('order-address')).toContainText('شارع سالم المبارك');
  await expect(page.getByText('الاتصال قبل الوصول')).toBeVisible();

  const status = page.getByTestId('order-status');
  const actions = page.getByTestId('order-actions');
  await actions.getByRole('button', { name: 'تأكيد الطلب' }).click();
  await expect(status).toHaveText('مؤكد');
  // Only the next step is offered: no jumping to "delivered".
  await expect(actions.getByRole('button', { name: 'تم التسليم' })).toHaveCount(0);
  await actions.getByRole('button', { name: 'بدء التجهيز' }).click();
  await expect(status).toHaveText('قيد التجهيز');
  await actions.getByRole('button', { name: 'خرج للتوصيل' }).click();
  await expect(status).toHaveText('خرج للتوصيل');

  await page.getByLabel('إضافة ملاحظة داخلية').fill('المندوب: خالد');
  await page.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByTestId('order-event').filter({ hasText: 'المندوب: خالد' })).toBeVisible();

  // Paid only after someone records the cash.
  await expect(page.getByTestId('payment-status')).toHaveText('غير مدفوع');
  await actions.getByRole('button', { name: 'تسجيل استلام المبلغ نقداً' }).click();
  await expect(page.getByTestId('payment-status')).toHaveText('مدفوع');
  await expect(actions.getByRole('button', { name: 'تسجيل استلام المبلغ نقداً' })).toHaveCount(0);
  await actions.getByRole('button', { name: 'تم التسليم' }).click();
  await expect(status).toHaveText('تم التسليم');
  await expect(actions).toContainText('لا توجد إجراءات أخرى');
  await expect(page.getByTestId('order-event')).toHaveCount(7);
  await expect(page.getByTestId('order-event').first()).toContainText('تم استلام الطلب من المتجر الإلكتروني');

  // The shopper's link follows along.
  await page.goto(orderUrl);
  await expect(page.getByTestId('order-status')).toHaveText('تم التسليم');
  await expect(page.getByTestId('order-payment')).toHaveText('الدفع عند الاستلام · مدفوع');
});

test('dashboard order pages fit a phone screen', async ({ page }, info) => {
  await login(page, owner);
  await page.setViewportSize({ width: 412, height: 915 });
  for (const locale of ['ar', 'en'] as const) {
    await page.goto(dash('/orders').replace('/ar/', `/${locale}/`));
    for (const name of ['orders', 'order']) {
      if (name === 'order') await page.getByTestId('order-row').getByRole('link').first().click();
      await expect(page.getByTestId(name === 'order' ? 'order-total' : 'order-row').first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${locale} ${name}`).toBeLessThanOrEqual(412);
      if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/dash-mobile-${name}-${locale}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(dash('/orders'));
  await page.getByTestId('order-row').getByRole('link').first().click();
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/dash-desktop-order-ar.png`, fullPage: true });
  await page.goto(dash('/delivery'));
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/dash-desktop-delivery-ar.png`, fullPage: true });
  void info;
});

test('pickup order in English, then cancelled by the merchant: stock comes back', async ({ page }) => {
  await addToCart(page, 'en', 'rose-perfume');
  expect(await stockOf(`${SLUG}-ROSE`)).toBe(3);
  await page.goto(shopUrl(SLUG, '/en/checkout'));
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await page.getByText('Pick up from store').click();
  await expect(page.getByTestId('pickup-instructions')).toHaveText('Collect from the Salmiya branch from 10 am');
  await expect(page.getByTestId('summary-delivery')).toHaveText('Free');
  await expect(page.getByTestId('summary-total')).toContainText('12.500');
  await expect(page.getByLabel('Street')).toHaveCount(0);
  await page.getByLabel('Full name').fill('Omar Khalid');
  await page.getByLabel('Phone number').fill('+965 6600 1122');
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page).toHaveURL(/\/en\/orders\//);
  const pickupUrl = page.url();
  await expect(page.getByTestId('order-number')).toHaveText('1002');
  await expect(page.getByTestId('order-total')).toContainText('12.500');
  await expect(page.getByText('Collect from the Salmiya branch from 10 am')).toBeVisible();
  expect(await stockOf(`${SLUG}-ROSE`)).toBe(2);

  await login(page, owner);
  await page.goto(dash('/orders'));
  await page.getByRole('link', { name: '#1002' }).click();
  const actions = page.getByTestId('order-actions');
  await actions.getByLabel('ملاحظة (اختياري)').fill('العميل ألغى الطلب');
  await actions.getByRole('button', { name: 'إلغاء الطلب' }).click();
  await expect(page.getByTestId('order-status')).toHaveText('ملغي');
  await expect(page.getByTestId('order-event').last()).toContainText('العميل ألغى الطلب');
  await expect(actions).toContainText('لا توجد إجراءات أخرى');
  expect(await stockOf(`${SLUG}-ROSE`)).toBe(3);

  await page.goto(pickupUrl);
  await expect(page.getByTestId('order-status')).toHaveText('Cancelled');
});

test('free delivery applies from the zone threshold, and the minimum order is enforced', async ({ page }) => {
  await addToCart(page, 'ar', 'oud-oil', '3ml', '3');
  await page.goto(shopUrl(SLUG, '/ar/checkout'));
  await page.getByLabel('منطقة التوصيل').selectOption({ label: 'العاصمة' });
  await expect(page.getByTestId('summary-delivery')).toHaveText('مجاني');
  await expect(page.getByTestId('summary-total')).toContainText('24.000');

  // Raise the minimum above the cart: the checkout page explains and offers no form.
  await apiCall(shop.token, 'PUT', `/v1/stores/${shop.storeId}/checkout-settings`, { pickupEnabled: true, minOrderAmount: 50000 });
  await page.reload();
  const notice = page.locator('p[role="alert"]');
  await expect(notice).toContainText('أقل من الحد الأدنى');
  await expect(notice).toContainText('50.000');
  await expect(page.getByRole('button', { name: 'تأكيد الطلب' })).toHaveCount(0);
});

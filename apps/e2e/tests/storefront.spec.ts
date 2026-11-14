import { expect, test } from '@playwright/test';
import { apiCall, login, seedShop, shopGet, shopUrl, type SeededShop } from './helpers';

const owner = 'shop.owner@example.com';
const rival = 'shop.rival@example.com';
const SLUG = 'sf-shop';
let shop: SeededShop;
let other: SeededShop;
let themePage = '';

test.describe.configure({ mode: 'serial' });

test('before launch the shop address shows nothing, and launch explains what is missing', async ({ page }) => {
  shop = await seedShop(page, owner, SLUG, 'عطور الدار');
  themePage = `/ar/dashboard/${shop.storeId}/theme`;
  expect((await page.goto(shopUrl(SLUG, '/ar')))?.status()).toBe(404);
  expect((await page.goto(shopUrl(SLUG, '/sitemap.xml')))?.status()).toBe(404);

  await login(page, owner);
  await page.goto(`/ar/dashboard/${shop.storeId}`);
  await page.getByRole('link', { name: 'المتجر والقالب' }).click();
  const status = page.getByTestId('storefront-status');
  await expect(status).toContainText('غير منشور بعد');
  await expect(status).toContainText('انشر قالباً أولاً');
  await status.getByRole('button', { name: 'نشر المتجر للزوار' }).click();
  await expect(status.getByRole('alert')).toContainText('انشر قالباً قبل نشر المتجر');
  await expect(page.getByTestId(/^theme-/)).toHaveCount(5);
});

test('merchant previews a theme privately; the preview is not public and not indexable', async ({ page, browser }) => {
  await login(page, owner);
  await page.goto(themePage);
  await page.getByTestId('theme-coffee-house').getByRole('button', { name: 'معاينة' }).click();
  await expect(page).toHaveURL(shopUrl(SLUG, '/ar'));
  await expect(page.locator('[data-theme]')).toHaveAttribute('data-theme', 'coffee-house');
  await expect(page.getByRole('status').filter({ hasText: 'وضع المعاينة' })).toBeVisible();
  await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', /noindex/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('عطور الدار');
  expect(await (await shopGet(page, shopUrl(SLUG, '/robots.txt'))).text()).toContain('Disallow: /');
  // The token never stays in the address bar and is not readable by scripts.
  expect(page.url()).not.toContain('preview');
  expect(await page.evaluate(() => document.cookie)).not.toContain('mtj_preview');

  // Someone else opening the same address sees nothing.
  const stranger = await browser.newContext({ locale: 'ar-KW' });
  expect((await (await stranger.newPage()).goto(shopUrl(SLUG, '/ar')))?.status()).toBe(404);
  await stranger.close();

  await page.getByRole('link', { name: 'إنهاء المعاينة' }).click();
  expect((await page.goto(shopUrl(SLUG, '/ar')))?.status()).toBe(404);
});

test('merchant customises a theme, publishes it and opens the store', async ({ page }) => {
  await login(page, owner);
  await page.goto(themePage);
  await page.getByTestId('theme-perfume-boutique').getByRole('link', { name: 'تخصيص' }).click();
  await expect(page.getByRole('heading', { name: /إعدادات القالب: بوتيك العطور/ })).toBeVisible();

  // Markup is refused and nothing typed is lost.
  await page.getByLabel('عنوان الصفحة الرئيسية (عربي)').fill('<b>عطور</b>');
  await page.getByRole('button', { name: 'حفظ المسودة' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'رموز غير مسموحة' })).toBeVisible();
  await expect(page.getByLabel('عنوان الصفحة الرئيسية (عربي)')).toHaveValue('<b>عطور</b>');

  await page.getByLabel('عنوان الصفحة الرئيسية (عربي)').fill('عطور تليق بك');
  await page.getByLabel('عنوان الصفحة الرئيسية (إنجليزي)').fill('Scents that suit you');
  await page.getByLabel('شريط الإعلان (عربي)').fill('توصيل لجميع مناطق الكويت');
  await page.getByLabel('اللون الأساسي').fill('#d4af37');
  await page.getByRole('button', { name: 'حفظ المسودة' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'تم حفظ المسودة' })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('عنوان الصفحة الرئيسية (عربي)')).toHaveValue('عطور تليق بك');
  await expect(page.getByLabel('اللون الأساسي')).toHaveValue('#d4af37');

  const card = page.getByTestId('theme-perfume-boutique');
  await card.getByRole('button', { name: 'نشر هذا القالب' }).click();
  await expect(card).toContainText('القالب الحالي');

  const status = page.getByTestId('storefront-status');
  await expect(status).toContainText('المتجر جاهز للنشر');
  await status.getByRole('button', { name: 'نشر المتجر للزوار' }).click();
  await expect(status).toContainText('المتجر منشور ومتاح للزوار');
  await expect(status.getByRole('link', { name: `${SLUG}.localhost` })).toHaveAttribute('href', shopUrl(SLUG, '/ar'));

  // Later edits stay a draft until published again.
  await page.getByLabel('شريط الإعلان (عربي)').fill('مسودة لم تنشر');
  await page.getByRole('button', { name: 'حفظ المسودة' }).click();
  await expect(card).toContainText('تعديلات غير منشورة');
});

test('a shopper browses the Arabic store: home, category, search, sort', async ({ page }) => {
  await page.goto(shopUrl(SLUG));
  await expect(page).toHaveURL(shopUrl(SLUG, '/ar'));
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('[data-theme]')).toHaveAttribute('data-theme', 'perfume-boutique');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('عطور تليق بك');
  await expect(page.getByText('توصيل لجميع مناطق الكويت')).toBeVisible();
  await expect(page.getByText('مسودة لم تنشر')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveCount(0); // no preview banner
  // The merchant's colour is applied.
  expect(await page.locator('[data-theme]').evaluate((el) => getComputedStyle(el).getPropertyValue('--p').trim().toLowerCase())).toBe('#d4af37');

  await expect(page.getByRole('link', { name: 'عطر الورد' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'دهن العود' }).first()).toBeVisible();
  await expect(page.getByText('مسودة سرية')).toHaveCount(0);
  const img = page.getByRole('img', { name: 'زجاجة عطر الورد' }).first();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);

  await page.getByRole('navigation').getByRole('link', { name: 'عطور', exact: true }).first().click();
  await expect(page).toHaveURL(/\/ar\/c\/perfume$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('عطور');
  await expect(page.getByTestId('result-count')).toContainText('2');

  await page.getByRole('link', { name: 'السعر: من الأعلى' }).click();
  await expect(page).toHaveURL(/sort=price_desc/);
  const names = await page.getByRole('main').getByRole('heading', { level: 3 }).allTextContents();
  expect(names.map((n) => n.trim())).toEqual(['عطر الورد', 'دهن العود']);

  await page.getByRole('searchbox').fill('العود');
  await page.getByRole('searchbox').press('Enter');
  await expect(page).toHaveURL(/\/ar\/products\?q=/);
  await expect(page.getByTestId('result-count')).toContainText('1');
  await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', /noindex/);
  await page.goto(shopUrl(SLUG, '/ar/products?q=zzzz'));
  await expect(page.getByText('لا توجد منتجات مطابقة')).toBeVisible();
  expect((await page.goto(shopUrl(SLUG, '/ar/c/does-not-exist')))?.status()).toBe(404);
  expect((await page.goto(shopUrl(SLUG, '/ar/p/secret-draft')))?.status()).toBe(404);
});

test('product page: variants, stock rules, add to cart, cart totals', async ({ page, context }) => {
  await page.goto(shopUrl(SLUG, '/ar/p/oud-oil'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('دهن العود');
  await expect(page.getByTestId('price')).toContainText('8.000');

  // The sold-out size can be looked at but not bought.
  await page.getByRole('button', { name: '12ml' }).click();
  await expect(page.getByTestId('price')).toContainText('30.000');
  await expect(page.getByTestId('availability')).toHaveText('غير متوفر');
  await expect(page.getByRole('button', { name: 'غير متوفر' })).toBeDisabled();

  await page.getByRole('button', { name: '3ml' }).click();
  await page.getByLabel('الكمية').selectOption('2');
  await page.getByRole('button', { name: 'أضف إلى السلة' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'تمت الإضافة' })).toBeVisible();
  await expect(page.getByTestId('cart-count')).toHaveText('2');

  // The cart cookie is httpOnly; nothing about the cart lives in page storage.
  const cookie = (await context.cookies()).find((c) => c.name === 'mtj_cart');
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax' });
  expect(await page.evaluate(() => document.cookie + Object.keys(localStorage).join())).not.toContain('mtj_cart');

  await page.goto(shopUrl(SLUG, '/ar/p/rose-perfume'));
  await expect(page.getByTestId('price')).toContainText('12.500');
  await expect(page.locator('s').filter({ hasText: '15.000' })).toBeVisible();
  await expect(page.getByText('عطر زهري ناعم')).toBeVisible();
  // Only 3 in stock: the picker stops there.
  await expect(page.getByLabel('الكمية').locator('option')).toHaveCount(3);
  await page.getByRole('button', { name: 'أضف إلى السلة' }).click();
  await expect(page.getByTestId('cart-count')).toHaveText('3');
  await page.getByRole('link', { name: 'عرض السلة' }).click();

  await expect(page).toHaveURL(/\/ar\/cart$/);
  const lines = page.getByTestId('cart-line');
  await expect(lines).toHaveCount(2);
  await expect(lines.filter({ hasText: 'دهن العود' }).getByTestId('line-total')).toContainText('16.000');
  await expect(lines.filter({ hasText: 'دهن العود' })).toContainText('3ml');
  await expect(page.getByTestId('subtotal')).toContainText('28.500');
  // This shop has no payment method or delivery set up: the page says so and offers no button that pretends otherwise.
  await expect(page.getByTestId('checkout-note')).toContainText('غير مفعّلين');
  await expect(page.getByRole('button', { name: /الدفع|إتمام|checkout/i })).toHaveCount(0);

  await lines.filter({ hasText: 'عطر الورد' }).getByLabel('الكمية').selectOption('3');
  await expect(page.getByTestId('subtotal')).toContainText('53.500');
  await lines.filter({ hasText: 'دهن العود' }).getByRole('button', { name: 'حذف' }).click();
  await expect(lines).toHaveCount(1);
  await expect(page.getByTestId('subtotal')).toContainText('37.500');
  await expect(page.getByTestId('cart-count')).toHaveText('3');

  // Adding beyond the stock is refused by the server.
  await page.goto(shopUrl(SLUG, '/ar/p/rose-perfume'));
  await page.getByRole('button', { name: 'أضف إلى السلة' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'غير متوفرة' })).toBeVisible();

  await page.goto(shopUrl(SLUG, '/ar/cart'));
  await page.getByRole('button', { name: 'حذف' }).click();
  await expect(page.getByText('سلتك فارغة')).toBeVisible();
});

test('English storefront is LTR with English content', async ({ page }) => {
  await page.goto(shopUrl(SLUG, '/ar/p/rose-perfume'));
  await page.getByRole('link', { name: 'English' }).first().click();
  await expect(page).toHaveURL(shopUrl(SLUG, '/en/p/rose-perfume')); // same page, other language
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rose Perfume');
  await expect(page.getByText('A soft floral scent')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to cart' })).toBeVisible();
  await page.goto(shopUrl(SLUG, '/en'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Scents that suit you');
});

test('search engines get canonical URLs, language alternates, product data, sitemap and robots', async ({ page }) => {
  const origin = shopUrl(SLUG);
  await page.goto(shopUrl(SLUG, '/ar/p/rose-perfume'));
  await expect(page).toHaveTitle('عطر الورد · عطور الدار');
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', `${origin}/ar/p/rose-perfume`);
  await expect(page.locator('link[rel=alternate][hreflang=en]')).toHaveAttribute('href', `${origin}/en/p/rose-perfume`);
  await expect(page.locator('meta[name=description]')).toHaveAttribute('content', /عطر زهري ناعم/);
  await expect(page.locator('meta[name=robots]')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);

  const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
  const product = ld.map((x) => JSON.parse(x)).find((x) => x['@type'] === 'Product');
  expect(product).toMatchObject({
    name: 'عطر الورد', url: `${origin}/ar/p/rose-perfume`,
    offers: { '@type': 'Offer', price: '12.500', priceCurrency: 'KWD', availability: 'https://schema.org/InStock' },
  });
  expect(product.image[0]).toMatch(/\.webp$/);
  expect(JSON.stringify(product)).not.toMatch(/cost|7000|7\.000/);

  await page.goto(shopUrl(SLUG, '/ar/p/oud-oil'));
  const oud = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((x) => JSON.parse(x)).find((x) => x['@type'] === 'Product');
  expect(oud.offers).toMatchObject({ '@type': 'AggregateOffer', lowPrice: '8.000', highPrice: '30.000', offerCount: 2 });

  const sitemap = await (await shopGet(page, `${origin}/sitemap.xml`)).text();
  for (const path of ['/ar', '/en', '/ar/products', '/ar/c/perfume', '/ar/p/rose-perfume', '/en/p/oud-oil']) expect(sitemap).toContain(`<loc>${origin}${path}</loc>`);
  expect(sitemap).not.toContain('secret-draft');
  expect(sitemap).toContain('hreflang="en"');
  const robots = await (await shopGet(page, `${origin}/robots.txt`)).text();
  expect(robots).toContain(`Sitemap: ${origin}/sitemap.xml`);
  expect(robots).toContain('Disallow: /ar/cart');
});

test('shops are separate sites: no dashboard, no other shop, no internal routes', async ({ page, context }) => {
  other = await seedShop(page, rival, 'sf-rival', 'Rival Shop');
  await apiCall(other.token, 'POST', `/v1/stores/${other.storeId}/theme/publish`, { themeId: 'modern-electronics' });
  await apiCall(other.token, 'POST', `/v1/stores/${other.storeId}/launch`);
  await apiCall(other.token, 'PATCH', `/v1/stores/${other.storeId}/products/${other.roseId}`, { nameAr: 'منتج المنافس', nameEn: 'Rival Product', slug: 'rival-product' });

  await page.goto(shopUrl('sf-rival', '/ar'));
  await expect(page.locator('[data-theme]')).toHaveAttribute('data-theme', 'modern-electronics');
  await expect(page.getByRole('link', { name: 'منتج المنافس' }).first()).toBeVisible();
  // A product of one shop does not exist on the other.
  expect((await page.goto(shopUrl(SLUG, '/ar/p/rival-product')))?.status()).toBe(404);
  expect((await page.goto(shopUrl('sf-rival', '/ar/p/rose-perfume')))?.status()).toBe(404);
  await page.goto(shopUrl(SLUG, '/ar/products'));
  await expect(page.getByText('منتج المنافس')).toHaveCount(0);

  // Carts belong to one shop: the cookie is scoped to its host.
  await page.goto(shopUrl(SLUG, '/ar/p/oud-oil'));
  await page.getByRole('button', { name: 'أضف إلى السلة' }).click();
  await expect(page.getByTestId('cart-count')).toHaveText('1');
  await page.goto(shopUrl('sf-rival', '/ar/cart'));
  await expect(page.getByTestId('cart-count')).toHaveText('0');
  expect((await context.cookies(shopUrl('sf-rival'))).some((c) => c.name === 'mtj_cart')).toBe(false);

  // The dashboard and login are not served on shop hosts; internal routes are closed everywhere.
  for (const url of [
    shopUrl(SLUG, '/ar/dashboard'), shopUrl(SLUG, '/ar/login'), shopUrl(SLUG, `/ar/dashboard/${shop.storeId}`),
    shopUrl(SLUG, '/s/sf-rival.localhost/ar'), `http://localhost:3100/s/${SLUG}.localhost/ar`, `http://localhost:3100/s/${SLUG}.localhost/sitemap.xml`,
    shopUrl('no-such-shop', '/ar'), shopUrl('no-such-shop', '/robots.txt'),
  ]) {
    expect((await shopGet(page, url)).status(), url).toBe(404);
  }
  // The platform site is unaffected.
  await page.goto('http://localhost:3100/ar');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('أنشئ متجرك');
  expect(await (await page.request.get('http://localhost:3100/robots.txt')).text()).not.toContain(SLUG);
});

test('the visual builder: add, reorder (drag and buttons), undo/redo, preview, publish, restore', async ({ page }) => {
  await login(page, owner);
  await page.goto(`${themePage}?theme=perfume-boutique`);
  const types = () => page.getByTestId('section-list').locator('li[data-type]').evaluateAll((els) => els.map((e) => e.getAttribute('data-type')));
  expect(await types()).toEqual(['hero', 'products', 'categories']);

  // The preview frame shows the saved draft on the real storefront, at the chosen device width.
  await expect(page.getByTestId('preview-frame')).toBeVisible();
  await page.getByTestId('device-tablet').click();
  await expect(page.getByTestId('device-tablet')).toHaveAttribute('aria-pressed', 'true');

  // Add a banner, fill it in, and bring it to the top with the buttons.
  await page.getByTestId('add-type').selectOption('banner');
  await page.getByTestId('add-section').click();
  expect(await types()).toEqual(['hero', 'products', 'categories', 'banner']);
  const banner = page.getByTestId('section-3');
  await banner.locator('summary').click();
  await banner.getByLabel('النص (عربي)').fill('شحن مجاني هذا الأسبوع');
  await expect(page.getByTestId('dirty')).toBeVisible();
  for (const i of [3, 2, 1]) await page.getByTestId(`up-${i}`).click();
  expect(await types()).toEqual(['banner', 'hero', 'products', 'categories']);

  // Undo takes one step back, redo returns.
  await page.getByTestId('undo').click();
  expect(await types()).toEqual(['hero', 'banner', 'products', 'categories']);
  await page.getByTestId('redo').click();
  expect(await types()).toEqual(['banner', 'hero', 'products', 'categories']);

  // Drag and drop moves a section too.
  await page.getByTestId('handle-1').dragTo(page.getByTestId('handle-3'));
  await expect.poll(types).toEqual(['banner', 'products', 'categories', 'hero']);
  await page.getByTestId('undo').click();
  expect(await types()).toEqual(['banner', 'hero', 'products', 'categories']);

  // Only one hero and one categories section: they are no longer offered.
  expect(await page.getByTestId('add-type').locator('option').evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value))).toEqual(['products', 'banner', 'text']);

  // Save: the preview now shows the banner; nothing is public yet.
  await page.getByTestId('save-draft').click();
  await expect(page.getByTestId('builder-status')).toContainText('تم حفظ المسودة');
  await expect(page.getByTestId('dirty')).toHaveCount(0);
  await expect(page.frameLocator('[data-testid=preview-frame]').getByText('شحن مجاني هذا الأسبوع')).toBeVisible();
  await page.goto(shopUrl(SLUG, '/ar'));
  await expect(page.getByText('شحن مجاني هذا الأسبوع')).toHaveCount(0);

  // Publish: shoppers see the banner above the headline.
  await page.goto(`${themePage}?theme=perfume-boutique`);
  await page.getByTestId('publish').click();
  await expect(page.getByTestId('builder-status')).toContainText('تم نشر القالب');
  await page.goto(shopUrl(SLUG, '/ar'));
  const bannerBox = await page.getByText('شحن مجاني هذا الأسبوع').boundingBox();
  const heroBox = await page.getByRole('heading', { level: 1 }).boundingBox();
  expect(bannerBox!.y).toBeLessThan(heroBox!.y);

  // Version history: restoring the oldest version only changes the draft.
  await page.goto(`${themePage}?theme=perfume-boutique`);
  const restores = page.getByTestId('restore-version');
  await expect(restores.first()).toBeVisible();
  expect(await restores.count()).toBeGreaterThanOrEqual(2);
  await restores.last().click();
  await expect(page.getByTestId('builder-status')).toContainText('استُعيد الإصدار');
  expect(await types()).toEqual(['hero', 'products', 'categories']);
  await page.goto(shopUrl(SLUG, '/ar'));
  await expect(page.getByText('شحن مجاني هذا الأسبوع')).toBeVisible(); // live page unchanged

  // Leave the draft as published so later steps are unaffected.
  await page.goto(`${themePage}?theme=perfume-boutique`);
  await page.getByTestId('publish').click();
  await expect(page.getByTestId('builder-status')).toContainText('تم نشر القالب');
});

test('every theme draws every kind of home section in the merchant’s order', async ({ page }) => {
  const overview = await apiCall<{ themes: { id: string; draft: Record<string, unknown> }[] }>(shop.token, 'GET', `/v1/stores/${shop.storeId}/theme`);
  const sections = [
    { id: 'b1', type: 'banner', textAr: 'عرض الأسبوع', textEn: 'Deal of the week', button: true },
    { id: 'h1', type: 'hero' },
    { id: 't1', type: 'text', titleAr: 'قصتنا', titleEn: 'Our story', bodyAr: 'نص تجريبي', bodyEn: 'Sample' },
    { id: 'c1', type: 'categories' },
    { id: 'p1', type: 'products', titleAr: 'الأكثر طلباً', titleEn: 'Most wanted', categoryId: null, limit: 4 },
  ];
  // Markup in a section is refused, as it is everywhere else.
  await expect(apiCall(shop.token, 'POST', `/v1/stores/${shop.storeId}/theme/draft`, { themeId: 'perfume-boutique', settings: { ...overview.themes[0]!.draft, sections: sections.map((x) => (x.type === 'text' ? { ...x, bodyAr: '<b>x</b>' } : x)) } })).rejects.toThrow('invalid_text');
  for (const th of overview.themes) {
    await apiCall(shop.token, 'POST', `/v1/stores/${shop.storeId}/theme/draft`, { themeId: th.id, settings: { ...th.draft, sections } });
    await apiCall(shop.token, 'POST', `/v1/stores/${shop.storeId}/theme/publish`, { themeId: th.id });
    const res = await shopGet(page, shopUrl(SLUG, '/ar'));
    expect(res.status(), th.id).toBe(200);
    const html = await res.text();
    for (const needle of ['عرض الأسبوع', 'قصتنا', 'الأكثر طلباً', '<h1']) expect(html, `${th.id}: ${needle}`).toContain(needle);
    // Order is the merchant's: banner, then headline, then the story.
    expect(html.indexOf('عرض الأسبوع'), th.id).toBeLessThan(html.indexOf('<h1'));
    expect(html.indexOf('<h1'), th.id).toBeLessThan(html.indexOf('قصتنا'));
  }
  // Put the perfume theme back as the later steps expect.
  const perfume = overview.themes.find((x) => x.id === 'perfume-boutique')!;
  await apiCall(shop.token, 'POST', `/v1/stores/${shop.storeId}/theme/draft`, { themeId: 'perfume-boutique', settings: perfume.draft });
  await apiCall(shop.token, 'POST', `/v1/stores/${shop.storeId}/theme/publish`, { themeId: 'perfume-boutique' });
});

test('switching theme changes the design and nothing else; taking the store offline hides it', async ({ page }) => {
  await login(page, owner);
  await page.goto(themePage);
  const coffee = page.getByTestId('theme-coffee-house');
  await coffee.getByRole('button', { name: 'نشر هذا القالب' }).click();
  await expect(coffee).toContainText('القالب الحالي');

  await page.goto(shopUrl(SLUG, '/ar'));
  await expect(page.locator('[data-theme]')).toHaveAttribute('data-theme', 'coffee-house');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('عطور الدار'); // this theme's own (default) headline
  await expect(page.getByRole('link', { name: 'عطر الورد' }).first()).toBeVisible();
  await page.goto(shopUrl(SLUG, '/ar/products'));
  await expect(page.getByTestId('result-count')).toContainText('2');

  // Back to the first theme: its customisation is still there.
  await page.goto(themePage);
  await page.getByTestId('theme-perfume-boutique').getByRole('link', { name: 'تخصيص' }).click();
  await expect(page.getByLabel('عنوان الصفحة الرئيسية (عربي)')).toHaveValue('عطور تليق بك');

  const status = page.getByTestId('storefront-status');
  await status.getByRole('button', { name: 'إيقاف عرض المتجر' }).click();
  await expect(status).toContainText('غير منشور بعد');
  expect((await page.goto(shopUrl(SLUG, '/ar')))?.status()).toBe(404);
  await page.goto(`/ar/dashboard/${shop.storeId}/products`);
  await expect(page.getByRole('row').filter({ hasText: 'عطر الورد' })).toBeVisible(); // nothing was deleted

  await page.goto(`/ar/dashboard/${shop.storeId}/audit`);
  for (const action of ['theme.published', 'store.launched', 'store.unlaunched']) {
    await expect(page.getByRole('cell', { name: action, exact: true }).first()).toBeVisible();
  }
});

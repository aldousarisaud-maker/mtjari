import { expect, test, type Page } from '@playwright/test';
import { login, mailLink, register } from './helpers';

const owner = 'catalog.owner@example.com';
const viewer = 'catalog.viewer@example.com';
const outsider = 'catalog.outsider@example.com';
let storeUrl = '';
let productUrl = '';

test.describe.configure({ mode: 'serial' });

async function openStore(page: Page) {
  await login(page, owner);
  await page.goto(storeUrl);
}

test('owner creates a store, a category and a brand', async ({ page }) => {
  await register(page, owner, 'نورة');
  await login(page, owner);
  await page.getByRole('link', { name: 'متجر جديد' }).click();
  await page.getByLabel('رابط المتجر').fill('catalog-shop');
  await expect(page.getByText('الرابط متاح')).toBeVisible();
  await page.getByLabel('اسم المتجر').fill('متجر المنتجات');
  await page.getByRole('button', { name: 'إنشاء المتجر' }).click();
  await expect(page).toHaveURL(/\/ar\/dashboard\/[0-9a-f-]{36}$/);
  storeUrl = new URL(page.url()).pathname;

  await page.getByRole('link', { name: 'التصنيفات' }).click();
  await expect(page.getByText('لا توجد تصنيفات بعد')).toBeVisible();
  await page.getByLabel('الاسم بالعربية').fill('ملابس');
  await page.getByRole('button', { name: 'إضافة التصنيف' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'ملابس' })).toBeVisible();
  // A child category is listed under its parent.
  await page.getByLabel('الاسم بالعربية').fill('قمصان');
  await page.getByLabel('التصنيف الأب').selectOption({ label: 'ملابس' });
  await page.getByRole('button', { name: 'إضافة التصنيف' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'قمصان' })).toBeVisible();
  // A parent with children cannot be deleted.
  await page.getByRole('listitem').filter({ hasText: 'ملابس' }).getByRole('button', { name: 'حذف' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'التصنيفات الفرعية' })).toBeVisible();

  await page.getByRole('link', { name: 'العلامات التجارية' }).click();
  await page.getByLabel('اسم العلامة').fill('دار الأناقة');
  await page.getByRole('button', { name: 'إضافة العلامة' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'دار الأناقة' })).toBeVisible();
});

test('owner creates a product with size variants; prices, margin and stock are stored', async ({ page }) => {
  await openStore(page);
  await page.getByRole('link', { name: 'المنتجات', exact: true }).click();
  await expect(page.getByText('لا توجد منتجات بعد')).toBeVisible();
  await page.getByRole('link', { name: 'منتج جديد' }).click();

  await page.getByLabel('الاسم بالعربية').fill('قميص قطني');
  await page.getByLabel('الاسم بالإنجليزية').fill('Cotton shirt');
  await page.getByLabel('الحالة').selectOption('ACTIVE');
  await page.getByLabel('العلامة التجارية').selectOption({ label: 'دار الأناقة' });
  await page.getByLabel('قمصان').check();
  await page.getByLabel('نوع المنتج').selectOption('VARIANT');

  // Submitting before generating variants is refused by the API.
  await page.getByLabel('السعر', { exact: false }).first().fill('12.500');
  await page.getByRole('button', { name: 'إنشاء المنتج' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  // A rejected form keeps everything that was typed.
  await expect(page.getByLabel('الاسم بالعربية')).toHaveValue('قميص قطني');
  await expect(page.getByLabel('نوع المنتج')).toHaveValue('VARIANT');

  await page.getByLabel('اسم الخيار').fill('المقاس');
  await page.getByLabel('القيم مفصولة').fill('S, M');
  await page.getByRole('button', { name: 'توليد الخيارات' }).click();
  await expect(page.getByLabel('السعر S', { exact: true })).toHaveValue('12.500'); // copied from the first row
  await page.getByLabel('التكلفة S', { exact: true }).fill('5.000');
  await expect(page.getByTestId('margin').first()).toHaveText('60%');
  await page.getByLabel('SKU S', { exact: true }).fill('SHIRT-S');
  await page.getByLabel('الكمية S', { exact: true }).fill('10');
  await page.getByLabel('تنبيه عند S', { exact: true }).fill('8');
  await page.getByLabel('السعر M', { exact: true }).fill('14');
  await page.getByLabel('SKU M', { exact: true }).fill('SHIRT-M');
  await page.getByLabel('الكمية M', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'إنشاء المنتج' }).click();

  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/);
  productUrl = new URL(page.url()).pathname;
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('قميص قطني');
  // Values come back from the database in the store currency (KWD, 3 decimals).
  await expect(page.getByLabel('السعر S', { exact: true })).toHaveValue('12.500');
  await expect(page.getByLabel('السعر M', { exact: true })).toHaveValue('14.000');
  await expect(page.getByLabel('قمصان')).toBeChecked();

  // The list shows the price range and total stock.
  await page.goto(`${storeUrl}/products`);
  const row = page.getByRole('row').filter({ hasText: 'قميص قطني' });
  await expect(row).toContainText('12.500');
  await expect(row).toContainText('14.000');
  await expect(row).toContainText('14'); // 10 + 4
  await expect(row).toContainText('منشور');

  // Search and status filter hit the API.
  await page.getByRole('searchbox').fill('SHIRT-M');
  await page.getByRole('button', { name: 'تصفية' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'قميص قطني' })).toBeVisible();
  await page.getByRole('searchbox').fill('لا-يوجد');
  await page.getByRole('button', { name: 'تصفية' }).click();
  await expect(page.getByText('لا توجد منتجات بعد')).toBeVisible();
});

test('owner edits the product and uploads an image that is served resized', async ({ page }) => {
  await openStore(page);
  await page.goto(productUrl);
  await page.getByLabel('الاسم بالعربية').fill('قميص قطني فاخر');
  await page.getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'تم الحفظ' })).toBeVisible();
  await expect(page.getByLabel('الاسم بالعربية')).toHaveValue('قميص قطني فاخر');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('قميص قطني فاخر');

  // A text file with an image extension is rejected by the server.
  await page.locator('input[type=file]').setInputFiles({ name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await page.locator('button[type=submit]', { hasText: 'رفع صورة' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'ليس صورة' })).toBeVisible();

  const png = await page.screenshot({ type: 'png' });
  await page.locator('input[type=file]').setInputFiles({ name: 'shirt.png', mimeType: 'image/png', buffer: png });
  await page.getByLabel('النص البديل للصورة').fill('قميص أبيض');
  await page.locator('button[type=submit]', { hasText: 'رفع صورة' }).click();
  const img = page.getByRole('img', { name: 'قميص أبيض' });
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  expect(await img.getAttribute('src')).toMatch(/\.webp$/);

  await page.goto(`${storeUrl}/products`);
  await expect(page.getByRole('row').filter({ hasText: 'قميص قطني فاخر' }).locator('img')).toHaveCount(1);
});

test('stock adjustments update the balance and the movement ledger', async ({ page }) => {
  await openStore(page);
  await page.getByRole('link', { name: 'المخزون', exact: true }).click();
  const rowS = page.getByTestId('stock-row').filter({ hasText: 'SHIRT-S' });
  await expect(rowS.getByTestId('qty')).toHaveText('10');

  await rowS.getByLabel('التغيير').fill('-3');
  await rowS.getByLabel('السبب').selectOption('DAMAGE');
  await rowS.getByRole('button', { name: 'تطبيق' }).click();
  await expect(rowS.getByTestId('qty')).toHaveText('7');
  await expect(rowS).toContainText('منخفض'); // threshold is 8
  const move = page.getByTestId('movement-row').first();
  await expect(move).toContainText('تالف');
  await expect(move).toContainText('-3');
  await expect(move).toContainText('7');

  // Stock can never go below zero.
  await rowS.getByLabel('التغيير').fill('-50');
  await rowS.getByRole('button', { name: 'تطبيق' }).click();
  await expect(rowS.getByRole('alert').filter({ hasText: 'لا تكفي' })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('stock-row').filter({ hasText: 'SHIRT-S' }).getByTestId('qty')).toHaveText('7');

  await page.getByLabel('المنخفض فقط').check();
  await page.getByRole('button', { name: 'تصفية' }).click();
  await expect(page.getByTestId('stock-row')).toHaveCount(1);

  // Overview cards read the same numbers.
  await page.goto(storeUrl);
  const cards = page.getByTestId('catalog-summary');
  await expect(cards.getByRole('link').filter({ hasText: 'مخزون منخفض' })).toContainText('1');
  await expect(cards.getByRole('link').filter({ hasText: 'منتجات منشورة' })).toContainText('1');
});

test('CSV export downloads the catalogue and import reports bad rows', async ({ page }) => {
  await openStore(page);
  await page.goto(`${storeUrl}/products`);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'تصدير CSV' }).click()]);
  expect(download.suggestedFilename()).toBe('products.csv');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const csv = Buffer.concat(chunks).toString('utf8');
  expect(csv).toContain('SHIRT-S');
  expect(csv).toContain('قميص قطني فاخر');
  expect(csv).toContain('12.500');

  const file = ['name_ar,price,sku,stock', 'عطر عود,25.000,OUD-1,6', 'منتج بسعر خاطئ,abc,BAD-1,1'].join('\n');
  await page.getByLabel('CSV').setInputFiles({ name: 'import.csv', mimeType: 'text/csv', buffer: Buffer.from(file, 'utf8') });
  await page.getByRole('button', { name: 'استيراد', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '1 منتج جديد' })).toBeVisible();
  await expect(page.getByTestId('import-errors')).toContainText('3'); // the bad row number
  await expect(page.getByRole('row').filter({ hasText: 'عطر عود' })).toContainText('25.000');
  await expect(page.getByRole('row').filter({ hasText: 'منتج بسعر خاطئ' })).toHaveCount(0);
});

test('a viewer can read the catalogue but has no way to change it', async ({ page, browser }) => {
  await openStore(page);
  await page.goto(`${storeUrl}/team`);
  await page.getByLabel('البريد الإلكتروني').fill(viewer);
  await page.locator('#roleId').selectOption({ label: 'مشاهد' });
  await page.getByRole('button', { name: 'إرسال الدعوة' }).click();
  await expect(page.getByRole('status')).toContainText('تم إرسال الدعوة');
  const invite = await mailLink(viewer);

  const ctx = await browser.newContext({ locale: 'ar-KW' });
  const vp = await ctx.newPage();
  await register(vp, viewer, 'مشاهد');
  await login(vp, viewer);
  await vp.goto(invite);
  await vp.getByRole('button', { name: 'قبول الدعوة' }).click();
  await expect(vp).toHaveURL(new RegExp(`${storeUrl}$`));

  await vp.goto(`${storeUrl}/products`);
  await expect(vp.getByRole('row').filter({ hasText: 'قميص قطني فاخر' })).toBeVisible();
  await expect(vp.getByRole('link', { name: 'منتج جديد' })).toHaveCount(0);
  await expect(vp.getByRole('button', { name: 'استيراد', exact: true })).toHaveCount(0);
  expect((await vp.goto(`${storeUrl}/products/new`))?.status()).toBe(404);

  await vp.goto(productUrl);
  await expect(vp.getByLabel('الاسم بالعربية')).toBeDisabled();
  await expect(vp.getByRole('button', { name: 'حذف المنتج' })).toHaveCount(0);
  await expect(vp.locator('input[type=file]')).toHaveCount(0);

  await vp.goto(`${storeUrl}/inventory`);
  await expect(vp.getByTestId('stock-row').first()).toBeVisible();
  await expect(vp.getByRole('button', { name: 'تطبيق' })).toHaveCount(0);
  await vp.goto(`${storeUrl}/categories`);
  await expect(vp.getByRole('button', { name: 'حذف' })).toHaveCount(0);
  await ctx.close();
});

test('another merchant cannot see or export this catalogue', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'ar-KW' });
  const p = await ctx.newPage();
  await register(p, outsider, 'غريب');
  await login(p, outsider);
  for (const path of ['/products', '/products/new', '/products/export', '/categories', '/brands', '/inventory', productUrl.replace(storeUrl, '')]) {
    const res = await p.goto(`${storeUrl}${path}`).catch(() => null);
    expect(res?.status(), path).toBe(404);
  }
  await ctx.close();
});

test('owner deletes the product; it leaves the list and inventory', async ({ page }) => {
  await openStore(page);
  await page.goto(productUrl);
  await page.getByRole('button', { name: 'حذف المنتج' }).click();
  await expect(page).toHaveURL(new RegExp(`${storeUrl}/products$`));
  await expect(page.getByRole('row').filter({ hasText: 'قميص قطني فاخر' })).toHaveCount(0);
  expect((await page.goto(productUrl))?.status()).toBe(404);
  await page.goto(`${storeUrl}/inventory`);
  await expect(page.getByTestId('stock-row').filter({ hasText: 'SHIRT-S' })).toHaveCount(0);
});

import { expect, test } from '@playwright/test';
import { login, mailLink, register } from './helpers';

const owner = 'owner.e2e@example.com';
const staff = 'staff.e2e@example.com';
const outsider = 'outsider.e2e@example.com';
let storeUrl = '';

test.describe.configure({ mode: 'serial' });

test('landing page is Arabic RTL by default and switches to English LTR', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/ar$/);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('أنشئ متجرك');
  await page.getByRole('link', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Launch your online store');
});

test('dashboard requires sign-in', async ({ page }) => {
  await page.goto('/ar/dashboard');
  await expect(page).toHaveURL(/\/ar\/login$/);
});

test('merchant signs up, verifies email, creates a store and edits it', async ({ page }) => {
  await register(page, owner, 'سعود');
  await login(page, owner);
  await expect(page.getByText('لا يوجد لديك متجر بعد')).toBeVisible();

  await page.getByRole('link', { name: 'متجر جديد' }).click();
  await page.getByLabel('رابط المتجر').fill('admin');
  await expect(page.getByText('هذا الاسم محجوز')).toBeVisible();
  await page.getByLabel('رابط المتجر').fill('e2e-shop');
  await expect(page.getByText('الرابط متاح')).toBeVisible();
  await page.getByLabel('اسم المتجر').fill('متجر الاختبار');
  await page.getByLabel('نوع النشاط').selectOption('perfume');
  await page.getByRole('button', { name: 'إنشاء المتجر' }).click();

  await expect(page).toHaveURL(/\/ar\/dashboard\/[0-9a-f-]{36}$/);
  storeUrl = new URL(page.url()).pathname;
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('متجر الاختبار');
  await expect(page.getByText('e2e-shop.mtjari.cc').first()).toBeVisible();

  await page.getByLabel('اسم المتجر').fill('عطور الخليج');
  await page.getByLabel('العملة').selectOption('SAR');
  await page.getByRole('button', { name: 'حفظ التغييرات' }).click();
  await expect(page.getByRole('status')).toContainText('تم الحفظ');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('عطور الخليج');
  await expect(page.getByLabel('نوع النشاط')).toHaveValue('perfume'); // untouched fields survive
});

test('tokens are httpOnly cookies, invisible to page scripts', async ({ page, context }) => {
  await login(page, owner);
  expect(await page.evaluate(() => document.cookie)).not.toMatch(/mtj_/);
  const cookies = await context.cookies();
  expect(cookies.filter((c) => c.name.startsWith('mtj_')).every((c) => c.httpOnly && c.sameSite === 'Lax')).toBe(true);
  expect(await page.evaluate(() => Object.keys(localStorage).length + Object.keys(sessionStorage).length)).toBe(0);
});

test('an expired access token is refreshed transparently, even for parallel requests', async ({ page, context }) => {
  await login(page, owner);
  const before = (await context.cookies()).find((c) => c.name === 'mtj_rt')!.value;
  await context.clearCookies({ name: 'mtj_at' }); // what the browser does when the access cookie expires
  // Several requests race with the same (rotating) refresh token.
  const statuses = await Promise.all(
    ['', '/team', '/roles', '/audit'].map((p) => context.request.get(`${storeUrl}${p}`).then((r) => r.status())),
  );
  expect(statuses).toEqual([200, 200, 200, 200]);
  await page.goto(storeUrl);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('عطور الخليج');
  const after = await context.cookies();
  expect(after.find((c) => c.name === 'mtj_rt')!.value).not.toEqual(before); // rotated
  expect(after.some((c) => c.name === 'mtj_at')).toBe(true);
});

test('owner invites staff; staff joins with limited access', async ({ page, browser }) => {
  await login(page, owner);
  await page.goto(`${storeUrl}/team`);
  await page.getByLabel('البريد الإلكتروني').fill(staff);
  await page.getByRole('button', { name: 'إرسال الدعوة' }).click();
  await expect(page.getByRole('status')).toContainText('تم إرسال الدعوة');
  const invite = await mailLink(staff);

  const ctx = await browser.newContext({ locale: 'ar-KW' });
  const sp = await ctx.newPage();
  await register(sp, staff, 'موظف');
  await login(sp, staff);
  await sp.goto(invite);
  await sp.getByRole('button', { name: 'قبول الدعوة' }).click();
  await expect(sp).toHaveURL(new RegExp(`${storeUrl}$`));
  await expect(sp.getByRole('heading', { level: 1 })).toHaveText('عطور الخليج');

  // Staff: no team/roles/audit navigation, no settings form, and direct URLs are refused.
  await expect(sp.getByRole('link', { name: 'الموظفون' })).toHaveCount(0);
  await expect(sp.getByRole('button', { name: 'حفظ التغييرات' })).toHaveCount(0);
  for (const section of ['team', 'roles', 'audit']) {
    const res = await sp.goto(`${storeUrl}/${section}`);
    expect(res?.status()).toBe(404);
  }
  await ctx.close();

  await page.reload();
  await expect(page.getByRole('cell', { name: /موظف/ }).first()).toBeVisible();
});

test('audit log shows the real history', async ({ page }) => {
  await login(page, owner);
  await page.goto(`${storeUrl}/audit`);
  for (const action of ['store.created', 'store.updated', 'member.invited', 'member.joined']) {
    await expect(page.getByRole('cell', { name: action, exact: true }).first()).toBeVisible();
  }
});

test('another merchant cannot open this store', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'ar-KW' });
  const p = await ctx.newPage();
  await register(p, outsider, 'غريب');
  await login(p, outsider);
  for (const path of ['', '/team', '/roles', '/audit']) {
    const res = await p.goto(`${storeUrl}${path}`);
    expect(res?.status()).toBe(404);
  }
  await expect(p.getByText('عطور الخليج')).toHaveCount(0);
  await ctx.close();
});

test('wrong password shows an error; sign-out ends the session', async ({ page }) => {
  await page.goto('/ar/login');
  await page.getByLabel('البريد الإلكتروني').fill(owner);
  await page.getByLabel('كلمة المرور').fill('definitely-wrong-pass');
  await page.getByRole('button', { name: 'دخول' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'غير صحيحة' })).toBeVisible();

  await login(page, owner);
  await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
  await expect(page).toHaveURL(/\/ar$/);
  await page.goto('/ar/dashboard');
  await expect(page).toHaveURL(/\/ar\/login$/);
});

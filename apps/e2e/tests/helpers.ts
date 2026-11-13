import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'correct-horse-battery';

/** Reads the newest email for an address from the SMTP sink and returns its link. */
export async function mailLink(to: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`http://127.0.0.1:2526/?to=${encodeURIComponent(to)}`);
    const mail = (await res.json()) as { body: string } | null;
    const match = mail?.body.match(/http:\/\/localhost:\d+\/(?:ar|en)\/[a-z/-]+\?token=[A-Za-z0-9_-]+/);
    if (match) return match[0];
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no email with a link arrived for ${to}`);
}

export async function register(page: Page, email: string, name: string) {
  await page.goto('/ar/register');
  await page.getByLabel('الاسم').fill(name);
  await page.getByLabel('البريد الإلكتروني').fill(email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'إنشاء الحساب' }).click();
  await expect(page.getByRole('status')).toContainText('رابط التأكيد');
  await page.goto(await mailLink(email));
  await page.getByRole('button', { name: 'تأكيد البريد' }).click();
  await expect(page.getByRole('status')).toContainText('تم تأكيد بريدك');
}

export async function login(page: Page, email: string) {
  await page.goto('/ar/login');
  await page.getByLabel('البريد الإلكتروني').fill(email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await expect(page).toHaveURL(/\/ar\/dashboard$/);
}

// ---- direct API access, used only to prepare data quickly ---------------
export const API = 'http://127.0.0.1:4100';
export const WEB_PORT = 3100;
export const shopUrl = (slug: string, path = '') => `http://${slug}.localhost:${WEB_PORT}${path}`;

/**
 * Plain HTTP GET of a shop URL from the test process. Node does not resolve
 * *.localhost, so connect to 127.0.0.1 and name the shop in the Host header,
 * sending the browser's cookies for that shop. Redirects are not followed.
 */
export async function shopGet(page: Page, url: string) {
  const u = new URL(url);
  const cookie = (await page.context().cookies(url)).map((c) => `${c.name}=${c.value}`).join('; ');
  return page.request.get(`http://127.0.0.1:${u.port}${u.pathname}${u.search}`, {
    headers: { host: u.host, ...(cookie ? { cookie } : {}) }, maxRedirects: 0,
  });
}

export async function apiLogin(email: string): Promise<string> {
  const res = await fetch(`${API}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  return ((await res.json()) as { tokens: { accessToken: string } }).tokens.accessToken;
}

export async function apiCall<T = Record<string, unknown>>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

export async function apiUploadImage(token: string, storeId: string, productId: string, png: Buffer, alt: string) {
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'photo.png');
  form.set('altAr', alt);
  const res = await fetch(`${API}/v1/stores/${storeId}/products/${productId}/media`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  if (!res.ok) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
}

export interface SeededShop { token: string; storeId: string; slug: string; roseId: string; oudId: string }

/**
 * A verified merchant with a store and a small catalogue: a category, a
 * simple product with an image and a discount, a product with two sizes (one
 * sold out) and an unpublished draft. Nothing is published or launched.
 */
export async function seedShop(page: Page, email: string, slug: string, name: string): Promise<SeededShop> {
  await register(page, email, 'تاجر');
  const token = await apiLogin(email);
  const store = await apiCall<{ id: string }>(token, 'POST', '/v1/stores', { name, slug });
  const base = `/v1/stores/${store.id}`;
  const cat = await apiCall<{ id: string }>(token, 'POST', `${base}/categories`, { nameAr: 'عطور', nameEn: 'Perfume' });
  const rose = await apiCall<{ id: string }>(token, 'POST', `${base}/products`, {
    nameAr: 'عطر الورد', nameEn: 'Rose Perfume', status: 'ACTIVE', categoryIds: [cat.id],
    descriptionAr: 'عطر زهري ناعم\nيدوم طويلاً', descriptionEn: 'A soft floral scent',
    variants: [{ sku: `${slug}-ROSE`, price: 12500, compareAtPrice: 15000, cost: 7000, initialStock: 3 }],
  });
  const oud = await apiCall<{ id: string }>(token, 'POST', `${base}/products`, {
    nameAr: 'دهن العود', nameEn: 'Oud Oil', status: 'ACTIVE', type: 'VARIANT', categoryIds: [cat.id],
    options: [{ name: 'الحجم', values: ['3ml', '12ml'] }],
    variants: [
      { optionValues: { 'الحجم': '3ml' }, sku: `${slug}-OUD3`, price: 8000, initialStock: 5 },
      { optionValues: { 'الحجم': '12ml' }, sku: `${slug}-OUD12`, price: 30000, initialStock: 0 },
    ],
  });
  await apiCall(token, 'POST', `${base}/products`, { nameAr: 'مسودة سرية', nameEn: 'Secret Draft', status: 'DRAFT', variants: [{ price: 1000, initialStock: 1 }] });
  await apiUploadImage(token, store.id, rose.id, await page.screenshot({ type: 'png' }), 'زجاجة عطر الورد');
  return { token, storeId: store.id, slug, roseId: rose.id, oudId: oud.id };
}
